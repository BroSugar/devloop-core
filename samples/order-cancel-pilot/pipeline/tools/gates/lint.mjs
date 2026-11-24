#!/usr/bin/env node
// 静态检查门禁（示例规则，接真实仓库时换成 eslint / biome / checkstyle）。
// 规则刻意“可机械判定”：无 AST，只看文本，保证零依赖也能给出稳定信号。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN = ['apps', 'packages'];

const RULES = [
  { id: 'no-console-log', re: /\bconsole\.log\s*\(/, msg: '源码里不允许 console.log，请用 console.error 或删除' },
  { id: 'no-debugger', re: /\bdebugger\b/, msg: '残留 debugger 语句' },
  { id: 'no-todo', re: /\b(TODO|FIXME|XXX)\b/, msg: '残留 TODO/FIXME，未完成的工作不能合入' },
  { id: 'no-var', re: /(^|\s)var\s+/, msg: '使用 let/const，禁止 var' },
  { id: 'max-line', re: null, msg: '单行超过 140 字符' },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(abs, out);
    } else if (/\.(mjs|js|ts)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(path.join(root, d)));
const findings = [];
for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.id === 'max-line') {
        if (line.length > 140) findings.push({ file: rel, line: i + 1, rule: rule.id, msg: `${rule.msg}（${line.length} 字符）` });
      } else if (rule.re.test(line)) {
        findings.push({ file: rel, line: i + 1, rule: rule.id, msg: rule.msg });
      }
    }
  });
}

for (const f of findings) console.log(`${f.file}:${f.line}  [${f.rule}] ${f.msg}`);
console.log(`[lint] 检查 ${files.length} 个文件，发现 ${findings.length} 个问题`);
process.exit(findings.length ? 1 : 0);
