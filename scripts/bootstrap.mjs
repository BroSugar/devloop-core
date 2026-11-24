#!/usr/bin/env node
// clone 之后跑一次：把 samples/ 下的示例仓库复制到 repos/ 并初始化成独立 git 仓库。
// 平台管理的是「外部 checkout」，所以示例仓本身不内嵌进本仓库（repos/ 在 .gitignore 里）。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples');
const REPOS = path.join(ROOT, 'repos');

const git = (cwd, args) => spawnSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(SAMPLES)) {
  console.error('samples/ 不存在，无需初始化');
  process.exit(0);
}

fs.mkdirSync(REPOS, { recursive: true });
let created = 0;

for (const name of fs.readdirSync(SAMPLES).sort()) {
  const src = path.join(SAMPLES, name);
  if (!fs.statSync(src).isDirectory()) continue;
  const dst = path.join(REPOS, name);

  if (fs.existsSync(dst)) {
    const isRepo = fs.existsSync(path.join(dst, '.git'));
    console.log(`- ${name}: ${isRepo ? '已存在，跳过' : '目录已存在但不是 git 仓库，跳过（请手动清理）'}`);
    continue;
  }

  copyDir(src, dst);
  const init = git(dst, ['init', '-q', '-b', 'main']);
  if (init.status !== 0) {
    console.error(`x ${name}: git init 失败`);
    process.exitCode = 1;
    continue;
  }
  git(dst, ['config', 'user.email', 'sample@devloop.local']);
  git(dst, ['config', 'user.name', 'devloop sample']);
  git(dst, ['add', '-A']);
  const commit = git(dst, ['commit', '-q', '-m', 'chore(sample): 初始导入（实现为桩，验收测试为红）']);
  if (commit.status !== 0) {
    console.error(`x ${name}: 初始提交失败`);
    process.exitCode = 1;
    continue;
  }
  console.log(`+ ${name}: 已初始化 → repos/${name}`);
  created++;
}

console.log(`\n完成：新建 ${created} 个示例仓库。下一步：node server/index.mjs`);
