#!/usr/bin/env node
// 测试门禁：把仓库里所有 *.test.mjs 在同一进程内 import，交给 node:test 汇总。
// 单进程聚合是刻意的：本沙箱禁止子进程管道，且聚合后报告更完整。
// 换成真实仓库时，这条命令替换为 `pnpm test` / `mvn test` / `go test ./...`。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN = ['apps', 'packages'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(abs, out);
    } else if (/\.test\.(mjs|js|ts)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const only = process.argv.slice(2).map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''));
const all = SCAN.flatMap((d) => walk(path.join(root, d)));
const files = only.length
  ? all.filter((f) => {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    return only.some((p) => rel === p || rel.startsWith(`${p}/`));
  })
  : all;

if (!files.length) {
  console.log(`[test] 没有找到任何测试文件${only.length ? `（过滤条件：${only.join(', ')}）` : ''}`);
  process.exit(1);
}
for (const file of files) await import(pathToFileURL(file).href);
console.log(`[test] 已聚合 ${files.length} 个测试文件`);
