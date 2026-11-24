// 卡同步与冲突检测测试：三方比较、导出、导入、冲突不覆盖。
// 全部在临时目录里进行，不碰仓库内的真实卡文件。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDb, migrate, ROOT } from '../db.mjs';
import { Store } from '../store.mjs';
import { computeSyncState, exportCards, importCards } from '../cards/sync.mjs';
import { renderTask, canonicalTask, hashOf } from '../cards/render.mjs';
import { parseYaml } from '../cards/yaml.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devloop-sync-'));
const repoDir = path.join(tmp, 'repo');
const specDir = path.join(tmp, 'spec');
const tasksDir = path.join(tmp, 'tasks');
for (const d of [repoDir, specDir, tasksDir]) fs.mkdirSync(d, { recursive: true });

fs.copyFileSync(path.join(ROOT, 'projects/demo-clamp/spec/REQ-001.yaml'), path.join(specDir, 'REQ-001.yaml'));
fs.copyFileSync(path.join(ROOT, 'projects/demo-clamp/tasks/T-001.yaml'), path.join(tasksDir, 'T-001.yaml'));

const db = openDb(path.join(tmp, 'sync.db'));
migrate(db);
const store = new Store(db);
const project = store.upsertProject({ id: 'sync-demo', name: '同步测试', stack: 'node-plain', repoPath: repoDir, cardsMode: 'platform' });
const config = {
  project: {
    id: 'sync-demo', repo_path: repoDir, dir: tmp, cards: { mode: 'platform' },
    spec_path: specDir, tasks_path: tasksDir,
  },
  gates: {}, policy: {},
};
const taskFile = path.join(tasksDir, 'T-001.yaml');

test.after(() => {
  try { db.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 上文件句柄可能未释放 */ }
});

test('渲染 → 解析 往返一致（导出前自检的基础）', () => {
  importCards(store, project, config, { prefer: 'force' });
  const task = store.getTask('T-001');
  const text = renderTask(task);
  const parsed = parseYaml(text);
  assert.equal(parsed.id, 'T-001');
  assert.equal(parsed.requirement, 'REQ-001');
  assert.deepEqual(parsed.scope.write, task.scope.write);
  assert.deepEqual(parsed.verify, task.verify.map((v) => v.ref));
  assert.deepEqual(parsed.acceptance, task.acceptance);
});

test('首次导入后两侧状态为 synced', () => {
  const state = computeSyncState(store, project, config);
  assert.equal(state.items.length, 2);
  assert.ok(state.items.every((i) => i.state === 'synced'), JSON.stringify(state.items.map((i) => [i.id, i.state])));
});

test('只有 DB 改动 → db_ahead → 导出后文件更新并回到 synced', () => {
  const task = store.getTask('T-001');
  store.updateTask('T-001', { ...task, title: '实现 clamp（改）' }, task.version);

  let state = computeSyncState(store, project, config);
  const item = state.items.find((i) => i.id === 'T-001');
  assert.equal(item.state, 'db_ahead');
  assert.equal(item.action, 'export');

  const dry = exportCards(store, project, config, { dryRun: true });
  assert.equal(dry.counts['would-export'], 1);
  assert.ok(!fs.readFileSync(taskFile, 'utf8').includes('实现 clamp（改）'), 'dry-run 不得落盘');

  const real = exportCards(store, project, config);
  assert.equal(real.counts.exported, 1);
  assert.ok(fs.readFileSync(taskFile, 'utf8').includes('实现 clamp（改）'));

  state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'synced');
});

test('只有文件改动 → file_ahead，导出被拦、导入生效', () => {
  fs.appendFileSync(taskFile, '# 仓库里手动改了一行注释\n');

  let state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'file_ahead');

  const blocked = exportCards(store, project, config);
  assert.equal(blocked.counts.blocked, 1);
  assert.equal(blocked.counts.exported, undefined);

  const imported = importCards(store, project, config);
  assert.equal(imported.counts.imported, 1);

  state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'synced');
});

test('两侧都改 → conflict，导出与导入都不覆盖', () => {
  const task = store.getTask('T-001');
  store.updateTask('T-001', { ...task, title: 'DB 侧的新标题' }, task.version);
  const before = fs.readFileSync(taskFile, 'utf8');
  fs.appendFileSync(taskFile, '# 文件侧也改了\n');
  const tampered = fs.readFileSync(taskFile, 'utf8');

  const state = computeSyncState(store, project, config);
  const item = state.items.find((i) => i.id === 'T-001');
  assert.equal(item.state, 'conflict');
  assert.equal(item.action, 'manual');

  const exported = exportCards(store, project, config);
  assert.equal(exported.counts.blocked, 1);
  assert.equal(fs.readFileSync(taskFile, 'utf8'), tampered, '冲突时不得写文件');

  const imported = importCards(store, project, config);
  assert.equal(imported.counts.conflict, 1);
  assert.equal(store.getTask('T-001').title, 'DB 侧的新标题', '冲突时不得覆盖 DB');

  void before;
});

test('DB 有、文件没有 → db_only，导出可新建文件', () => {
  const task = store.getTask('T-001');
  fs.rmSync(taskFile);

  let state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'db_only');

  exportCards(store, project, config);
  assert.equal(fs.existsSync(taskFile), true);
  state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'synced');
});

test('规范化哈希对字段顺序不敏感（deps / acceptance 排序）', () => {
  const task = store.getTask('T-001');
  const a = canonicalTask({ ...task, deps: ['T-2', 'T-1'], acceptance: ['AC-2', 'AC-1'] });
  const b = canonicalTask({ ...task, deps: ['T-1', 'T-2'], acceptance: ['AC-1', 'AC-2'] });
  assert.equal(hashOf(a), hashOf(b));
});

test('冲突需要显式 force 才能解决（safe 永远不覆盖）', () => {
  // 造一个冲突：DB 改标题 + 文件改注释
  const task = store.getTask('T-001');
  store.updateTask('T-001', { ...task, title: 'DB 侧唯一标题' }, task.version);
  fs.appendFileSync(taskFile, '# 冲突注释\n');

  let state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'conflict');

  // safe：两边都不动
  assert.equal(exportCards(store, project, config).counts.blocked, 1);
  assert.equal(store.getTask('T-001').title, 'DB 侧唯一标题');
  assert.ok(fs.readFileSync(taskFile, 'utf8').includes('# 冲突注释'));

  // force：以 DB 为准覆盖文件
  assert.equal(exportCards(store, project, config, { prefer: 'force' }).counts.exported, 1);
  assert.ok(fs.readFileSync(taskFile, 'utf8').includes('DB 侧唯一标题'));
  assert.ok(!fs.readFileSync(taskFile, 'utf8').includes('# 冲突注释'));

  state = computeSyncState(store, project, config);
  assert.equal(state.items.find((i) => i.id === 'T-001').state, 'synced');
});
