// CI 契约测试：钉住 workflow 与 package.json 的形状。
// 先于实现写；它红着，才谈得上"实现完成"。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('package.json：Node 24 下限、pnpm 锁定、根不引依赖', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true);
  assert.match(pkg.engines.node, />=\s*24/);
  assert.match(pkg.packageManager, /^pnpm@/);
  assert.equal(pkg.dependencies, undefined, '根 package.json 不得引入依赖（依赖归各 workspace/子包）');
  assert.equal(pkg.devDependencies, undefined, '根 package.json 不得引入依赖');
  for (const s of ['bootstrap', 'test', 'verify', 'client:build', 'server:install']) {
    assert.ok(pkg.scripts[s], `缺少脚本 ${s}`);
  }
});

test('package.json：verify 里 bootstrap 必须先于测试', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.match(scripts.verify, /npm run bootstrap/);
  assert.match(scripts.verify, /npm test/);
  assert.ok(
    scripts.verify.indexOf('bootstrap') < scripts.verify.indexOf('npm test'),
    'verify 必须先 bootstrap 再测试',
  );
});

function onBlock(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.notEqual(start, -1, '缺少顶层 on: 块');
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block;
}

function nested(block, key) {
  const idx = block.findIndex((l) => new RegExp(`^ {2}${key}:`).test(l));
  if (idx < 0) return null;
  const out = [];
  for (let i = idx + 1; i < block.length && /^ {4}\S/.test(block[i]); i++) {
    if (block[i].trim() !== '') out.push(block[i].trim());
  }
  return out;
}

test('workflow：触发条件挂在 push 上，pull_request 不带过滤', () => {
  const block = onBlock(read('.github/workflows/ci.yml'));
  assert.deepEqual(nested(block, 'push'), ['branches: [main]'], 'push 必须且只能过滤 main');
  assert.deepEqual(nested(block, 'pull_request'), [], 'pull_request 不得有 branches/types 过滤，否则 PR 静默不触发');
});

test('workflow：只用两个官方 action、固定 ubuntu + Node 24', () => {
  const yml = read('.github/workflows/ci.yml');
  const actions = [...yml.matchAll(/^\s*-\s+uses:\s*(\S+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(actions, ['actions/checkout@v4', 'actions/setup-node@v4']);
  assert.match(yml, /runs-on:\s*ubuntu-latest/);
  assert.match(yml, /node-version:\s*['"]24['"]/);
});

test('workflow：起 PG、装后端依赖、构建前端、再跑同一条 verify', () => {
  const yml = read('.github/workflows/ci.yml');
  assert.match(yml, /^\s{4}services:/m, '必须声明 services');
  assert.match(yml, /image:\s*postgres:18/, 'CI 需要 PostgreSQL 18');
  assert.match(yml, /pg_isready/, '等待数据库健康');
  assert.match(yml, /DATABASE_URL:\s*postgres:\/\//, '注入数据库连接');
  assert.match(yml, /npm --prefix server ci/, '后端依赖必须安装');
  assert.match(yml, /pnpm --dir client install --frozen-lockfile/, '前端依赖必须按锁文件安装');
  assert.match(yml, /pnpm --dir client build/, '前端必须构建（否则前端坏了 CI 也绿）');
  assert.match(yml, /npm run verify/, '最终跑与本地一致的入口');
});
