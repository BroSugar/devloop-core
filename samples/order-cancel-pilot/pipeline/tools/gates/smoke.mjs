#!/usr/bin/env node
// 构建门禁：加载全部源码模块，捕获语法错误 / 错误的 import 路径 / 顶层异常。
// 换成真实仓库时，这条命令替换为 `pnpm build` / `tsc -b` / `mvn -q -DskipTests package`。

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
    } else if (/\.(mjs|js|ts)$/.test(entry.name) && !/\.test\.(mjs|js|ts)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(path.join(root, d)));
let failed = 0;
for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (e) {
    failed++;
    console.error(`[build] 加载失败 ${path.relative(root, file).replace(/\\/g, '/')}`);
    console.error(`        ${String(e.message).split('\n')[0]}`);
  }
}
console.log(`[build] 加载 ${files.length} 个模块，失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
