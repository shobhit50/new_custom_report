"""Research-only Universal Report Builder reference renderer.
Frozen visual hierarchy: blocks[] -> tables[] -> header[][] / rows.data[].cells[].
No network, code execution from formulas, body cell merges, or absolute placements.
"""
from __future__ import annotations
import ast, copy, datetime as dt, html, json, math, re
from pathlib import Path
from jsonschema import Draft202012Validator
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

class ConfigError(ValueError): pass
class DataError(ValueError): pass
class CycleError(ConfigError): pass

MAX_ROWS, MAX_COLS, MAX_CELLS, MAX_DAYS = 2000, 120, 150000, 366
FORMAT_TYPES = {'text', 'integer', 'number', 'currency', 'percent'}
BINDING_KEYS = ('source','metric','segment','period')

def num(v):
    if v is None or v == '': return None
    if isinstance(v, bool): raise DataError('Boolean is not numeric')
    try: x=Decimal(str(v))
    except (InvalidOperation, ValueError): raise DataError(f'Non-numeric value: {v!r}')
    if not x.is_finite(): raise DataError('NaN and Infinity not allowed')
    return x

def iso(s):
    try: return dt.date.fromisoformat(s)
    except Exception: raise ConfigError(f'Invalid ISO date {s!r}')

def periods_for(table, today):
    def resolve(x):
        if x == 'report_date': return today
        if x == 'month_start(report_date)': return today.replace(day=1)
        if x == 'year_start(report_date)': return today.replace(month=1,day=1)
        return iso(x)
    result={}
    for key,p in table.get('periods',{}).items():
        start,end=resolve(p['start_date']), resolve(p['end_date'])
        if start>end: raise ConfigError('start_date after end_date: '+key)
        if (end-start).days>3660: raise ConfigError('Period exceeds 10 years')
        result[key]=(start.isoformat(),end.isoformat())
    return result

def substitute(value, ctx):
    if isinstance(value,str):
        def sub(m):
            k=m.group(1)
            if k not in ctx: raise ConfigError('Unknown expansion variable: '+k)
            return str(ctx[k])
        return re.sub(r'\{([a-zA-Z_][\w]*)\}',sub,value)
    return value

def compatible_merge(*parts):
    out={}
    for part in parts:
        for k,v in part.items():
            if v is None: continue
            if k in out and out[k]!=v:
                raise ConfigError(f'Conflicting constraint {k}: {out[k]!r} vs {v!r}')
            out[k]=v
    return out

def binding(part,ctx):
    return {k:substitute(part[k],ctx) for k in BINDING_KEYS if k in part}

def axis_values(rep, datasets, periods):
    by=rep.get('by'); alias=rep.get('as')
    if not alias or not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',alias): raise ConfigError('Invalid repeat alias')
    if by=='values':
        src,field=rep.get('source'),rep.get('field')
        ds=datasets.get(src)
        if not ds: raise ConfigError('Unknown repeat dataset: '+str(src))
        if field not in ds['columns']: raise ConfigError('Unknown repeat field: '+str(field))
        values=list(dict.fromkeys(r.get(field) for r in ds['rows'] if r.get(field) is not None))
        if rep.get('sort','asc')=='asc': values=sorted(values,key=str)
        elif rep.get('sort')=='desc': values=sorted(values,key=str,reverse=True)
        elif rep.get('sort')!='source': raise ConfigError('Invalid repeat sort')
    elif by=='days':
        p=rep.get('period')
        if p not in periods: raise ConfigError('Unknown repeated period: '+str(p))
        start,end=map(iso,periods[p]); length=(end-start).days+1
        if length>MAX_DAYS: raise ConfigError('Daily expansion too long')
        values=[(start+dt.timedelta(days=i)).isoformat() for i in range(length)]
    else: raise ConfigError('Repeat by must be values or days')
    if len(values)>MAX_COLS: raise ConfigError('Too many repeated columns')
    return alias,values

def expand_headers(header,datasets,periods):
    axes={}; expanded=[]
    for row in header:
        out=[]
        for item in row:
            if 'repeat' in item:
                if item.get('rowspan',1)!=1 or item.get('colspan',1)!=1:
                    raise ConfigError('Dynamic header with rowspan/colspan not supported')
                alias,vals=axis_values(item['repeat'],datasets,periods)
                if alias in axes and axes[alias]!=vals: raise ConfigError('Repeat alias conflict: '+alias)
                axes[alias]=vals
                for val in vals:
                    c=copy.deepcopy(item); c.pop('repeat'); c['_context']={alias:val}; out.append(c)
            else:
                c=copy.deepcopy(item); c['_context']={};out.append(c)
        expanded.append(out)
    if not expanded: return [],[],axes
    height=len(expanded); occ={}; display=[]
    for y,items in enumerate(expanded):
        entries=[]; x=0
        for it in items:
            while (y,x) in occ:x+=1
            rs,cs=it.get('rowspan',1),it.get('colspan',1)
            if not isinstance(rs,int) or not isinstance(cs,int) or rs<1 or cs<1 or y+rs>height: raise ConfigError('Bad header span')
            for yy in range(y,y+rs):
                for xx in range(x,x+cs):
                    if (yy,xx) in occ: raise ConfigError('Overlapping header spans')
                    occ[yy,xx]=it
            context=it['_context'];entries.append({'label':substitute(it.get('label',''),context),'rowspan':rs,'colspan':cs,'start':x,'item':it})
            x+=cs
        display.append(entries)
    width=max((x for (_,x) in occ),default=-1)+1
    if width>MAX_COLS: raise ConfigError('Header has too many columns')
    for yy in range(height):
        for xx in range(width):
            if (yy,xx) not in occ: raise ConfigError('Header has a hole')
    leaves=[]
    for x in range(width):
        path=[]
        for y in range(height):
            it=occ[(y,x)]
            if not path or path[-1] is not it: path.append(it)
        context={}; constraints={}; key=None
        for it in path:
            context=compatible_merge(context,it['_context'])
            constraints=compatible_merge(constraints,binding(it,context))
            if it.get('key') is not None: key=substitute(it['key'],context)
        if key is None: key=str(x)
        leaves.append({'key':str(key),'context':context,'binding':constraints,'label':display[-1][0]['label'] if not path else substitute(path[-1].get('label',''),context)})
    keys=[l['key'] for l in leaves]
    if len(keys)!=len(set(keys)): raise ConfigError('Duplicate leaf-column keys')
    return display,leaves,axes

def expand_cells(cells,axes):
    out=[]
    for cell in cells:
        rep=cell.get('repeat')
        if rep is not None:
            if rep not in axes: raise ConfigError('Cell repeat has no matching header alias: '+str(rep))
            for value in axes[rep]:
                c=copy.deepcopy(cell);c.pop('repeat');c['_context']={rep:value};out.append(c)
        else:
            c=copy.deepcopy(cell);c['_context']={};out.append(c)
    return out

class Engine:
    def __init__(self,datasets,today='2026-10-13'):
        self.datasets=datasets;self.today=iso(today)
        for sid,ds in datasets.items():
            if not isinstance(ds.get('rows'),list) or not isinstance(ds.get('columns'),list): raise ConfigError('Dataset must declare rows and columns: '+sid)
            if len(ds['columns'])!=len(set(ds['columns'])):raise ConfigError('Duplicate dataset field: '+sid)
            grain=ds.get('grain')
            if grain is None or (not grain and len(ds['rows'])>1):
                raise DataError('Dataset must declare a unique grain when it has multiple records: '+sid)
            if any(k not in ds['columns'] for k in grain):
                raise ConfigError('Grain refers to unknown dataset fields: '+sid)
            seen=set()
            for row in ds['rows']:
                if not isinstance(row,dict):raise DataError('Dataset record must be object')
                if set(row)-set(ds['columns']): raise DataError('Undeclared data fields: '+sid)
                if grain:
                    key=tuple(row.get(k) for k in grain)
                    if None in key:raise DataError('Null in dataset grain: '+sid)
                    if key in seen:raise DataError('Duplicate dataset grain: '+sid+' '+str(key))
                    seen.add(key)

    def source(self,src,field):
        if src not in self.datasets: raise ConfigError('Unknown source: '+str(src))
        if field not in self.datasets[src]['columns']: raise ConfigError(f'Unknown field {field!r} in source {src!r}')
        return self.datasets[src]['rows']

    def aggregate(self,src,field,where,period,periods,agg):
        records=self.source(src,field)
        unknown=set(where)-set(self.datasets[src]['columns'])
        if unknown:raise ConfigError(f'Filter fields not present in source {src}: {sorted(unknown)}')
        out=[]
        for rec in records:
            if any(rec.get(k)!=v for k,v in where.items()):continue
            if period:
                if period not in periods: raise ConfigError('Unknown period: '+str(period))
                lo,hi=periods[period]
                if 'date' not in self.datasets[src]['columns']: raise ConfigError('Period used on dataset without date column: '+src)
                d=rec.get('date')
                if d is None or not (lo<=d<=hi): continue
            out.append(rec)
        vals=[rec.get(field) for rec in out]
        if agg=='none':
            if len(vals)>1:raise DataError('Multiple records require aggregate or grain-specific row: '+src)
            return vals[0] if vals else None
        if agg=='count':return Decimal(len([v for v in vals if v is not None]))
        nums=[num(v) for v in vals if v is not None]
        if not nums:return None
        if agg=='sum':return sum(nums,Decimal(0))
        if agg=='avg':return sum(nums,Decimal(0))/len(nums)
        if agg=='min':return min(nums)
        if agg=='max':return max(nums)
        raise ConfigError('Invalid aggregate: '+str(agg))

    def table(self,table):
        periods=periods_for(table,self.today)
        display,leaves,axes=expand_headers(table.get('header',[]),self.datasets,periods)
        rows_cfg=table.get('rows',{})
        if rows_cfg.get('mode') not in ('static','dynamic'):raise ConfigError('rows.mode must be static|dynamic')
        if not isinstance(rows_cfg.get('data'),list):raise ConfigError('rows.data required')
        rows=[]
        for template in rows_cfg['data']:
            if rows_cfg['mode']=='static' and template.get('repeat')=='records':
                raise ConfigError('Static mode may not repeat dataset records')
            if rows_cfg['mode']=='dynamic' and not any(r.get('repeat')=='records' for r in rows_cfg['data']):
                raise ConfigError('Dynamic mode requires at least one records template')
            if template.get('repeat')=='records':
                src=template.get('source',rows_cfg.get('source'))
                for c in template.get('cells',[]):
                    if c.get('kind')=='field': self.source(src,c.get('field'))
            if template.get('repeat')=='records' and rows_cfg.get('mode')!='dynamic':
                raise ConfigError('Row repeat requires dynamic mode')
        for template in rows_cfg['data']:
            if template.get('repeat')=='records':
                src=template.get('source',rows_cfg.get('source'))
                if src not in self.datasets: raise ConfigError('Missing dynamic source')
                rowkey=rows_cfg.get('row_key')
                if not rowkey or any(k not in self.datasets[src]['columns'] for k in rowkey):raise ConfigError('row_key missing/unresolvable')
                records=list(self.datasets[src]['rows'])
                sort=template.get('sort')
                if sort:
                    field=sort['field'];self.source(src,field)
                    records.sort(key=lambda r:(r.get(field) is None,r.get(field)),reverse=(sort.get('direction','asc')=='desc'))
                if template.get('limit') is not None:
                    limit=template['limit']
                    if not isinstance(limit,int) or limit<=0:raise ConfigError('limit must be positive integer')
                    records=records[:limit]
                for rec in records:
                    identity=tuple(rec.get(k) for k in rowkey)
                    if None in identity:raise DataError('Null dynamic row identity')
                    rkey='|'.join(map(str,identity))
                    rows.append({'key':rkey,'template':template,'record':rec,'record_source':src})
            else:
                if template.get('repeat') is not None:raise ConfigError('Invalid row repeat')
                if 'key' not in template:raise ConfigError('Static row key required')
                rows.append({'key':template['key'],'template':template,'record':None,'record_source':None})
        if len(rows)>MAX_ROWS:raise ConfigError('Too many rendered rows')
        ids=[r['key'] for r in rows]
        if len(ids)!=len(set(ids)):raise DataError('Duplicate row identity')
        rendered=[]
        for row in rows:
            tpl=row['template'];cells=expand_cells(tpl.get('cells',[]),axes)
            if not leaves:
                if rendered and len(cells)!=len(rendered[0]['cells']):raise ConfigError('Header-less rows have different widths')
                if len(cells)>MAX_COLS:raise ConfigError('Too many cells')
            elif len(cells)!=len(leaves):raise ConfigError(f'Column-count mismatch in row {row["key"]}: expected {len(leaves)}, got {len(cells)}')
            c_out=[]
            for i,c in enumerate(cells):
                h=leaves[i] if leaves else {'key':str(i),'context':{},'binding':{}}
                ctx=compatible_merge(h['context'],c['_context'])
                rec_ctx=row['record'] or {}
                def resolve_where(obj):
                    resolved={}
                    for k,v in obj.items():
                        if isinstance(v,str):
                            full=re.fullmatch(r'\{([A-Za-z_][A-Za-z0-9_]*)\}',v)
                            if full and full.group(1) in {**rec_ctx,**ctx}:
                                v={**rec_ctx,**ctx}[full.group(1)]
                            else:v=substitute(v,{**rec_ctx,**ctx})
                        resolved[k]=v
                    return resolved
                where=compatible_merge(resolve_where(tpl.get('where',{})),resolve_where(c.get('where',{})))
                # Repeated dimension/date alias is a concrete filter only when its name is a source column.
                for axis,value in ctx.items():
                    if axis in where and where[axis]!=value:raise ConfigError('Conflicting axis/row filter')
                    where[axis]=value
                b=compatible_merge(h['binding'],binding(tpl,ctx),binding(c,ctx))
                # A repeated record must not accidentally print a dataset-wide total for every record.
                # Cross-record actual bindings require a filter referencing an identifier in that row.
                if rec_ctx and c.get('kind')=='actual':
                    raw_filters={**tpl.get('where',{}),**c.get('where',{})}
                    identity_fields=rows_cfg.get('row_key',[])
                    is_keyed=any(isinstance(v,str) and any('{'+k+'}' in v for k in identity_fields) for v in raw_filters.values())
                    if not is_keyed:
                        raise ConfigError('Repeated row actual cells must explicitly filter by a row identity; use field kind for same-record values')
                # Preserve separate row/header filters; normalized segment is a shared semantic dimension.
                if 'segment' in rec_ctx:
                    record_segment=rec_ctx['segment']
                    if 'segment' in b and b['segment']!=record_segment:
                        raise ConfigError('Dynamic row/header segment conflict')
                    b=compatible_merge(b,{'segment':record_segment})
                if 'segment' in b:where=compatible_merge(where,{'segment':b['segment']})
                c_out.append({'spec':c,'ctx':ctx,'where':where,'binding':b,'value':None,'resolved':False,'format':c.get('format',{})})
            rendered.append({'key':row['key'],'style':tpl.get('style','normal'),'record':row['record'],'record_source':row['record_source'],'cells':c_out})
        if not leaves:
            width=len(rendered[0]['cells']) if rendered else 0
            leaves=[{'key':str(i),'label':'','context':{},'binding':{}} for i in range(width)]
        if len(rendered)*len(leaves)>MAX_CELLS:raise ConfigError('Report exceeds cell limit')
        index={(r['key'],leaves[i]['key']):(r,i) for r in rendered for i in range(len(leaves))}
        running=set(); warnings=[]

        def resolve(row,i):
            key=(row['key'],leaves[i]['key']); c=row['cells'][i]
            if c['resolved']:return c['value']
            if key in running:raise CycleError('Circular formula reference: '+str(key))
            running.add(key)
            try:
                spec=c['spec'];kind=spec.get('kind');b=c['binding'];rec=row['record'];ctx=c['ctx']
                if kind=='literal':
                    if any(k in spec for k in ('source','metric','formula')):raise ConfigError('Literal has invalid binding')
                    v=substitute(spec.get('text',''),{**ctx,**(rec or {})})
                elif kind=='field':
                    if rec is None:raise ConfigError('Field cell requires dynamic record')
                    if b.get('source') and b['source']!=row['record_source']:
                        raise ConfigError('Field cell conflicts with header source')
                    field=spec.get('field')
                    if b.get('metric') and b['metric']!=field:
                        raise ConfigError('Field cell conflicts with header metric')
                    self.source(row['record_source'],field)
                    v=rec.get(field)
                elif kind=='actual':
                    source=b.get('source',row['record_source']);metric=b.get('metric')
                    if not source or not metric:raise ConfigError('Actual cell missing source/metric')
                    if rec is not None and source==row['record_source'] and not c['where'] and not b.get('period') and spec.get('aggregate') is None:
                        self.source(source,metric);v=rec.get(metric)
                    else:
                        v=self.aggregate(source,metric,c['where'],b.get('period'),periods,spec.get('aggregate','none'))
                elif kind=='calculated':
                    if not isinstance(spec.get('formula'),str):raise ConfigError('Calculated cell requires formula string')
                    def safe_div(a,bb):
                        a=num(a);bb=num(bb)
                        if a is None or bb is None or bb==0:
                            if bb==0:warnings.append('Division by zero: '+str(key))
                            return None
                        return a/bb
                    def metric_fn(src,field,period=None):
                        # Formula operands may reference any source; only segment/date/where dimensions apply.
                        p=period if period is not None else b.get('period')
                        return self.aggregate(src,field,c['where'],p,periods,'sum')
                    def field_fn(field):
                        if rec is None:raise ConfigError('FIELD() requires record')
                        self.source(row['record_source'],field)
                        return rec.get(field)
                    def cell_fn(row_key,col_key):
                        target=(str(row_key),str(col_key))
                        if target not in index:raise ConfigError('Unknown CELL reference: '+str(target))
                        rr,ii=index[target];return resolve(rr,ii)
                    def safe_sum(*args):
                        vals=[num(v) for v in args]
                        return None if not any(v is not None for v in vals) else sum((v for v in vals if v is not None),Decimal(0))
                    functions={'METRIC':metric_fn,'FIELD':field_fn,'CELL':cell_fn,'DIV':safe_div,'SUM':safe_sum,
                               'COALESCE':lambda *args:next((x for x in args if x is not None),None),
                               'ABS':lambda x:abs(num(x)) if num(x) is not None else None}
                    v=eval_formula(spec['formula'],functions)
                else:raise ConfigError('Unknown cell kind: '+str(kind))
                if isinstance(v,float) and not math.isfinite(v):raise DataError('Nonfinite result')
                c['value']=v;c['resolved']=True
                return v
            finally:running.discard(key)
        for r in rendered:
            for i in range(len(leaves)):resolve(r,i)
        return {'id':table.get('id','table'),'header':display,'leaves':leaves,'rows':rendered,'warnings':warnings}

    def render(self,config):
        schema=json.loads(Path(__file__).with_name('config.schema.json').read_text())
        errors=list(Draft202012Validator(schema).iter_errors(config))
        if errors:
            e=min(errors,key=lambda x:(len(x.path),str(x.path)))
            raise ConfigError(f'Schema error at {list(e.path)}: {e.message}')
        if config.get('schema_version')!=1:raise ConfigError('Expected schema_version 1')
        if config.get('layout') or config.get('blocks_direction') or config.get('tables_direction'):raise ConfigError('Placement controls prohibited by frozen layout')
        if not isinstance(config.get('blocks'),list) or not config['blocks']:raise ConfigError('At least one block required')
        built=[];block_ids=[]
        for b in config['blocks']:
            if 'layout' in b:raise ConfigError('Block layout override prohibited')
            block_ids.append(b['id']);tabs=[];seen_tabs=set()
            for table in b.get('tables',[]):
                if table['id'] in seen_tabs:raise ConfigError('Duplicate table ID within block: '+table['id'])
                seen_tabs.add(table['id'])
                for row in table.get('rows',{}).get('data',[]):
                    for c in row.get('cells',[]):
                        if 'rowspan' in c or 'colspan' in c:raise ConfigError('Body cell merge prohibited')
                tabs.append(self.table(table))
            built.append({'id':b['id'],'title':b.get('title',''),'tables':tabs})
        if len(block_ids)!=len(set(block_ids)):raise ConfigError('Duplicate block id')
        return {'name':config.get('template_name','Report'),'blocks':built}

def eval_formula(s,fn):
    if len(s)>512:raise ConfigError('Formula too long')
    try:root=ast.parse(s,mode='eval')
    except SyntaxError:raise ConfigError('Invalid formula syntax')
    count=0
    def calc(node,depth=0):
        nonlocal count
        count+=1
        if count>80 or depth>20:raise ConfigError('Formula too complex')
        if isinstance(node,ast.Expression):return calc(node.body,depth+1)
        if isinstance(node,ast.Constant) and type(node.value) in (int,float,str,type(None)):
            return num(node.value) if type(node.value) in (int,float) else node.value
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,ast.USub):
            v=num(calc(node.operand,depth+1));return None if v is None else -v
        if isinstance(node,ast.BinOp) and type(node.op) in (ast.Add,ast.Sub,ast.Mult,ast.Div):
            a=num(calc(node.left,depth+1));b=num(calc(node.right,depth+1))
            if a is None or b is None:return None
            if isinstance(node.op,ast.Add):return a+b
            if isinstance(node.op,ast.Sub):return a-b
            if isinstance(node.op,ast.Mult):return a*b
            return None if b==0 else a/b
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in fn and not node.keywords:
            args=[calc(arg,depth+1) for arg in node.args]
            if len(args)>12:raise ConfigError('Too many formula args')
            return fn[node.func.id](*args)
        raise ConfigError('Disallowed formula expression')
    return calc(root)

def format_value(v,spec):
    if v is None:return '-'
    style=spec.get('type','text');precision=spec.get('precision',2)
    if style not in FORMAT_TYPES:raise ConfigError('Bad format type')
    if style=='text':return str(v)
    if not isinstance(precision,int) or not 0<=precision<=6:raise ConfigError('Bad precision')
    value=num(v)
    if value is None:return '-'
    if style=='integer':return f'{value:,.0f}'
    if style=='percent':return f'{value*100:,.{precision}f}%'
    if style=='currency':return '₹'+f'{value:,.{precision}f}'
    return f'{value:,.{precision}f}'

def html_for(report):
    bits=['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report Builder: 30 Formats</title>',
          '<style>body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f4f6fb;color:#24314b;margin:0}.shell{max-width:1460px;margin:auto;padding:28px}.headline{margin:0 0 8px;font-size:32px}.muted{color:#667085}.nav{display:flex;flex-wrap:wrap;gap:7px;margin:20px 0}.nav a{color:#1d4ed8;border:1px solid #dbe3ed;padding:6px 9px;border-radius:7px;background:white;text-decoration:none;font-size:12px}.report{background:#fff;padding:22px;border:1px solid #dce2ed;border-radius:15px;margin:16px 0;box-shadow:0 4px 16px #18233b07}.report h2{font-size:19px;margin:0 0 15px}.block{margin:12px 0 24px}.block h3{font-size:14px;color:#334155}.table-wrap{overflow-x:auto;margin-bottom:16px}table{border-collapse:collapse;white-space:nowrap;width:max-content;min-width:55%;font-size:12px}td,th{border:1px solid #dce2ed;padding:8px 12px;text-align:left}th{background:#e8edf5;color:#344054;font-weight:700}.total td{font-weight:700;background:#f0f5ff}.subtle{color:#667085;font-size:12px}.empty{padding:18px;color:#667085;border:1px dashed #cbd5e1}</style></head><body><div class="shell">',
          '<h1 class="headline">Universal Report Builder / 30 Format Gallery</h1><p class="muted">Research renderer • Synthetic datasets • Frozen vertical blocks / tables • Rendered from JSON configurations</p>']
    bits.append('<div class="nav">')
    for ix,r in enumerate(report,1):bits.append(f'<a href="#r{ix:02}">{ix:02} {html.escape(r["name"])}</a>')
    bits.append('</div>')
    for ix,r in enumerate(report,1):
        bits.append(f'<section class="report" id="r{ix:02}"><h2>{ix:02}. {html.escape(r["name"])}</h2>')
        for block in r['blocks']:
            bits.append(f'<div class="block"><h3>{html.escape(block["title"])}</h3>')
            for tab in block['tables']:
                bits.append('<div class="table-wrap"><table>')
                if tab['header']:
                    bits.append('<thead>')
                    for line in tab['header']:
                        bits.append('<tr>')
                        for h in line:
                            bits.append(f'<th colspan="{h["colspan"]}" rowspan="{h["rowspan"]}">{html.escape(str(h["label"]))}</th>')
                        bits.append('</tr>')
                    bits.append('</thead>')
                bits.append('<tbody>')
                for row in tab['rows']:
                    bits.append('<tr class="total">' if row['style']=='total' else '<tr>')
                    for c in row['cells']:
                        val=format_value(c['value'],c['format']);bits.append('<td>'+html.escape(val)+'</td>')
                    bits.append('</tr>')
                if not tab['rows']:bits.append(f'<tr><td colspan="{max(1,len(tab["leaves"]))}" class="empty">No records for selected filters</td></tr>')
                bits.append('</tbody></table></div>')
                if tab['warnings']:bits.append('<p class="subtle">'+html.escape('; '.join(tab['warnings']))+'</p>')
            bits.append('</div>')
        bits.append('</section>')
    bits.append('</div></body></html>');return ''.join(bits)
