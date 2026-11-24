// CI 契约测试：钉住 workflow 与 package.json 的形状。
// 先于实现写；它红着，才谈得上"实现完成"。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

test('package.json：零依赖、Node 24 下限、三条脚本', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true);
  assert.match(pkg.engines.node, />=\s*24/);
  assert.equal(pkg.dependencies, undefined, '不得引入 npm 依赖');
  assert.equal(pkg.devDependencies, undefined, '不得引入 npm 依赖');
  assert.equal(pkg.scripts.bootstrap, 'node scripts/bootstrap.mjs');
  assert.match(pkg.scripts.test, /api\.test\.mjs/);
  assert.match(pkg.scripts.test, /cardsync\.test\.mjs/);
  assert.match(pkg.scripts.test, /ci-contract\.test\.mjs/);
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

test('workflow：PR 与 main push 触发，且只有两个官方 action', () => {
  const yml = read('.github/workflows/ci.yml');
  assert.match(yml, /^on:/m);
  assert.match(yml, /pull_request:/);
  assert.match(yml, /branches:\s*\[\s*main\s*\]/);
  const actions = [...yml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(actions, ['actions/checkout@v4', 'actions/setup-node@v4']);
  assert.match(yml, /node-version:\s*['"]?24['"]?/);
  assert.doesNotMatch(yml, /npm (ci|install)/, '零依赖仓库不应有安装步骤');
});

test('workflow：执行入口就是本地那条命令', () => {
  const yml = read('.github/workflows/ci.yml');
  assert.match(yml, /npm run verify/);
  assert.doesNotMatch(yml, /node server\/test\/api\.test\.mjs/, '命令顺序只在 package.json 里定义一次');
});
