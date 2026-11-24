// YAML 子集解析器（平台自包含，零依赖）。
// 生产化时替换为 yaml 包即可；解析器只影响卡与配置的读取，不影响执行语义。

export function parseYaml(text) {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const tokens = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(#|$)/.test(raw) || /^\s*---\s*$/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    const body = raw.trim();

    const blockHead = body.match(/^(.*?):\s*\|([-+]?)\s*$/);
    if (blockHead) {
      const content = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '') { content.push(''); continue; }
        const ind = line.length - line.trimStart().length;
        if (ind <= indent) break;
        content.push(line);
      }
      while (content.length && content[content.length - 1] === '') content.pop();
      const nonEmpty = content.filter((l) => l.trim() !== '');
      const base = nonEmpty.length ? Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length)) : 0;
      tokens.push({
        indent,
        text: `${blockHead[1].trim()}:`,
        block: content.map((l) => (l.trim() === '' ? '' : l.slice(base))).join('\n'),
        line: i + 1,
      });
      i = j - 1;
      continue;
    }
    tokens.push({ indent, text: body, line: i + 1 });
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const isItem = (t) => t.text === '-' || t.text.startsWith('- ');

  function parseNode(indent) {
    const t = peek();
    if (!t) return null;
    return isItem(t) ? parseList(indent) : parseMap(indent);
  }

  function parseMap(indent) {
    const out = {};
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.indent < indent) break;
      if (t.indent > indent) { pos++; continue; }
      if (isItem(t)) break;
      pos++;
      const idx = t.text.indexOf(':');
      if (idx < 0) throw new Error(`第 ${t.line} 行：期望 "key: value"，实际 "${t.text}"`);
      const key = unquote(t.text.slice(0, idx).trim());
      const rest = t.text.slice(idx + 1).trim();
      if (t.block !== undefined) { out[key] = t.block; continue; }
      if (rest !== '') { out[key] = scalar(rest); continue; }
      const next = peek();
      out[key] = !next || next.indent <= indent ? null : parseNode(next.indent);
    }
    return out;
  }

  function parseList(indent) {
    const out = [];
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.indent !== indent) { if (t.indent < indent) break; pos++; continue; }
      if (!isItem(t)) break;
      pos++;
      const itemText = t.text === '-' ? '' : t.text.slice(2).trim();
      if (itemText === '') {
        const next = peek();
        out.push(next && next.indent > indent ? parseNode(next.indent) : null);
        continue;
      }
      const colon = findKeyColon(itemText);
      if (colon < 0) { out.push(scalar(itemText)); continue; }

      const obj = {};
      const key = unquote(itemText.slice(0, colon).trim());
      const rest = itemText.slice(colon + 1).trim();
      const next = peek();
      obj[key] = rest !== '' ? scalar(rest) : (next && next.indent > indent && !isItem(next) ? parseNode(next.indent) : null);

      const childIndent = indent + 2;
      while (pos < tokens.length && tokens[pos].indent === childIndent && findKeyColon(tokens[pos].text) >= 0) {
        const t2 = tokens[pos];
        pos++;
        const i2 = t2.text.indexOf(':');
        const k2 = unquote(t2.text.slice(0, i2).trim());
        const r2 = t2.text.slice(i2 + 1).trim();
        if (r2 === '') {
          const n2 = peek();
          obj[k2] = n2 && n2.indent > childIndent ? parseNode(n2.indent) : null;
        } else {
          obj[k2] = scalar(r2);
        }
      }
      out.push(obj);
    }
    return out;
  }

  if (!tokens.length) return {};
  return parseNode(tokens[0].indent);
}

function findKeyColon(s) {
  if (/^["'[{]/.test(s)) return -1;
  const m = s.match(/^([A-Za-z0-9_\-./$]+)\s*:/);
  return m ? m[0].lastIndexOf(':') : -1;
}

function unquote(s) {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1);
  }
  return s;
}

function scalar(s) {
  const raw = s.trim();
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter((x) => x !== '');
  }
  const q = unquote(raw);
  if (q !== raw) return q;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}
