import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const template = fs.readFileSync(fileURLToPath(new URL('./report_template.html', import.meta.url)), 'utf8');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[character]);

function splitTop(expression, operator) {
  let depth = 0, quote = null;
  for (let index = 0; index <= expression.length - operator.length; index++) {
    const char = expression[index];
    if (quote) { if (char === quote && expression[index - 1] !== '\\') quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if ('(['.includes(char)) depth++;
    if (')]'.includes(char)) depth--;
    if (depth === 0 && expression.slice(index, index + operator.length) === operator) return [expression.slice(0, index), expression.slice(index + operator.length)];
  }
  return null;
}
function evaluate(raw, context) {
  const expression = raw.trim();
  for (const op of [' or ', ' and ', ' == ', ' != ', ' > ', ' < ']) {
    const parts = splitTop(expression, op);
    if (parts) {
      const a = evaluate(parts[0], context), b = evaluate(parts[1], context);
      return op === ' or ' ? a || b : op === ' and ' ? a && b : op === ' == ' ? a === b : op === ' != ' ? a !== b : op === ' > ' ? a > b : a < b;
    }
  }
  if (expression.startsWith('not ')) return !evaluate(expression.slice(4), context);
  if (expression.endsWith('|length')) { const value = evaluate(expression.slice(0, -7), context); return value?.length ?? 0; }
  if (expression === '[]') return [];
  if (/^(['"]).*\1$/.test(expression)) return expression.slice(1, -1);
  if (/^\d+$/.test(expression)) return Number(expression);
  const match = /^([A-Za-z_][\w]*)(.*)$/.exec(expression);
  if (!match) throw new Error(`Unsupported template expression: ${expression}`);
  let value = context[match[1]], rest = match[2];
  if (value === undefined) throw new Error(`Undefined template value: ${match[1]}`);
  while (rest) {
    let found;
    if ((found = /^\.get\((['"])(.*?)\1(?:,\s*([^)]*))?\)/.exec(rest))) {
      value = value?.[found[2]] ?? (found[3] ? evaluate(found[3], context) : null); rest = rest.slice(found[0].length);
    } else if ((found = /^\.([A-Za-z_][\w]*)/.exec(rest))) {
      value = value?.[found[1]]; rest = rest.slice(found[0].length);
    } else if ((found = /^\[(['"])(.*?)\1\]/.exec(rest))) {
      value = value?.[found[2]]; rest = rest.slice(found[0].length);
    } else throw new Error(`Unsupported template expression: ${expression}`);
    if (value === undefined) throw new Error(`Undefined template value: ${expression}`);
  }
  return value;
}
function tokenize(input) {
  const output = [], re = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/g;
  let end = 0, match;
  while ((match = re.exec(input))) {
    if (match.index > end) output.push({ type: 'text', value: input.slice(end, match.index) });
    output.push({ type: match[0].startsWith('{{') ? 'value' : 'tag', value: match[0].slice(2, -2).trim() });
    end = re.lastIndex;
  }
  if (end < input.length) output.push({ type: 'text', value: input.slice(end) });
  return output;
}
function parse(tokens) {
  let index = 0;
  const sequence = (until = []) => {
    const nodes = [];
    while (index < tokens.length) {
      const token = tokens[index++], command = token.value.split(/\s+/)[0];
      if (token.type === 'tag' && until.includes(command)) return [nodes, command];
      if (token.type !== 'tag') { nodes.push(token); continue; }
      if (command === 'if') {
        const [yes, stop] = sequence(['else', 'endif']);
        const no = stop === 'else' ? sequence(['endif'])[0] : [];
        nodes.push({ type: 'if', test: token.value.slice(3), yes, no });
      } else if (command === 'for') {
        const match = /^for\s+([A-Za-z_][\w]*)\s+in\s+(.+)$/.exec(token.value);
        if (!match) throw new Error(`Invalid template loop: ${token.value}`);
        const [body, stop] = sequence(['else', 'endfor']);
        const empty = stop === 'else' ? sequence(['endfor'])[0] : [];
        nodes.push({ type: 'for', name: match[1], list: match[2], body, empty });
      } else throw new Error(`Unsupported template tag: ${token.value}`);
    }
    return [nodes, null];
  };
  return sequence()[0];
}
const tree = parse(tokenize(template));
function renderNodes(nodes, context) {
  let output = '';
  for (const node of nodes) {
    if (node.type === 'text') output += node.value;
    else if (node.type === 'value') output += escapeHtml(evaluate(node.value, context));
    else if (node.type === 'if') output += renderNodes(evaluate(node.test, context) ? node.yes : node.no, context);
    else if (node.type === 'for') {
      const values = evaluate(node.list, context);
      if (!Array.isArray(values)) throw new Error(`Template loop is not an array: ${node.list}`);
      if (!values.length) output += renderNodes(node.empty, context);
      values.forEach((value, index) => { output += renderNodes(node.body, { ...context, [node.name]: value, loop: { first: index === 0, index: index + 1 } }); });
    }
  }
  return output;
}
export function renderReportTemplate(context) { return renderNodes(tree, context).replace(/\n$/, ''); }
