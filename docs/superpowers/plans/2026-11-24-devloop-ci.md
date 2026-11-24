# devloop-core CI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 devloop-core 加一条在干净环境跑契约测试的 CI，且 CI 与本地共用同一入口。

**Architecture:** 用 `package.json` 的 `verify` 脚本承载"先 bootstrap 再测试"这条不变式；workflow 只有一个执行步骤 `npm run verify`，避免两处各写一遍命令顺序。契约测试 `server/test/ci-contract.test.mjs` 先写，用来钉住 workflow 与 package.json 的形状。

**Tech Stack:** Node 24（`node:sqlite` 下限）、`node:test`、GitHub Actions（官方 checkout / setup-node）。

**Spec:** `docs/superpowers/specs/2026-11-24-devloop-ci-design.md`

## Global Constraints

- Node 固定 `>= 24`（`server/db.mjs` 用 `node:sqlite` 的 `DatabaseSync`）。
- 零 npm 依赖：不得出现 `dependencies` / `devDependencies`，因此 CI 中不得出现 `npm ci` / `npm install`，也不加 lockfile。
- 只允许官方 action：`actions/checkout@v4`、`actions/setup-node@v4`；不得引入第三方 action。
- `bootstrap` 必须先于测试执行，且该顺序只在 `scripts.verify` 里定义一次。
- workflow 与本地必须能跑同一条命令：`npm run verify`。
- 触发分支是 `main`（仓库默认分支）。

## Review Focus

- **干净环境**：本地 `repos/` 已存在会掩盖 bootstrap 失败。必须在全新 clone 里跑 `npm run verify`。
- **触发分支写错**：`branches: [master]` 时 PR 静默不触发，CI 永远绿——契约测试要钉住 `main`。
- **行尾差异**：本地 Windows 是 CRLF，runner 是 LF；契约测试读取时必须先归一化，否则本地假红。
- **Node 版本漂移**：runner 上 `node-version` 与 `engines.node` 不是同一个事实来源，两处都要被断言。
- **命令顺序漂移**：有人日后把 `verify` 改成 `npm test && npm run bootstrap`，测试必须在 CI 里显式 bootstrap 之外仍然失败。
- **多引入一个 action**：非官方 action 会扩大供应链面，契约测试断言 `uses:` 只允许两个。

---

### Task 1: CI 契约测试（先红）

**Files:**
- Create: `server/test/ci-contract.test.mjs`

**Interfaces:**
- Consumes: 无（独立 test 文件）。
- Produces: 可直接执行 `node server/test/ci-contract.test.mjs` 的测试文件；后续任务靠它转绿。

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 跑测试，确认它红**

Run: `node server/test/ci-contract.test.mjs`
Expected: 4 个 `✖`，首个报 `ENOENT ... package.json`（`ci-contract.test.mjs` 自身能加载，说明语法没问题）。

- [ ] **Step 3: 提交**

```bash
git add server/test/ci-contract.test.mjs
git commit -m "test: CI 契约测试（先红）"
```

---

### Task 2: `package.json`（单一入口）

**Files:**
- Create: `package.json`

**Interfaces:**
- Consumes: Task 1 的契约测试。
- Produces: `npm run bootstrap` / `npm test` / `npm run verify` 三个脚本，Task 3 的 workflow 只调用 `verify`。

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "devloop-core",
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "bootstrap": "node scripts/bootstrap.mjs",
    "test": "node server/test/api.test.mjs && node server/test/cardsync.test.mjs && node server/test/ci-contract.test.mjs",
    "verify": "npm run bootstrap && npm test"
  }
}
```

- [ ] **Step 2: 跑契约测试，确认只剩 workflow 两条红**

Run: `node server/test/ci-contract.test.mjs`
Expected: `pass 2` / `fail 2`（失败的两条都是 `ENOENT ... .github/workflows/ci.yml`）。

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "feat: 统一本地与 CI 的验证入口"
```

---

### Task 3: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 2 的 `npm run verify`。
- Produces: 一个 job `contract`，作为 PR 与 main push 的必过关卡。

- [ ] **Step 1: 写 workflow**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - name: 契约测试（与本地同一条命令）
        run: npm run verify
```

- [ ] **Step 2: 跑契约测试，确认全绿**

Run: `node server/test/ci-contract.test.mjs`
Expected: `pass 4` / `fail 0`。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: PR 与 main 上跑契约测试"
```

---

### Task 4: 干净 clone 验证（等同 CI 环境）

**Files:** 无变更（只产出证据）。

**Interfaces:**
- Consumes: Task 1–3 的全部产物。
- Produces: 一段可贴进 PR 的验证输出。

- [ ] **Step 1: 本仓库跑一次完整入口**

Run: `npm run verify`
Expected: 21 项断言全过（api 9 + cardsync 8 + ci-contract 4），退出码 0。

- [ ] **Step 2: 全新 clone 里跑同一条命令**

```bash
tmp=$(mktemp -d)
git clone -q "$(git rev-parse --show-toplevel)" "$tmp/devloop-core"
cd "$tmp/devloop-core"
ls repos 2>/dev/null || echo "repos/ 不存在（正是 CI 的起点）"
npm run verify
```

Expected: `repos/` 起初不存在，`bootstrap` 生成 3 个示例仓，测试全过，退出码 0。

- [ ] **Step 3: 清理并记录证据**

```bash
rm -rf "$tmp/devloop-core"
git status --porcelain   # 应为空
```

把两条命令的完整输出贴给评审者；**没有输出就没有"通过"这个结论**。

---

## Self-Review

- **Spec coverage**：目标（CI 跑契约测试）→ Task 3；单一入口（`npm run verify`）→ Task 2；判据先行 → Task 1；约束（Node 24 / 零依赖 / 官方 action）→ Task 1 断言；干净环境风险 → Task 4。设计文档中"留给构建者"的三项：step 命名（Task 3 已定）、不加 `.nvmrc`（本计划不创建该文件）、不传日志（未加步骤）。
- **Step scan**：每个 Step 都是一条可执行动作或一段确定内容；没有 "handle edge cases" 这类空指令。
- **Type consistency**：脚本名 `bootstrap`/`test`/`verify` 在 Task 1 断言、Task 2 定义、Task 3 使用三处一致。
- **Review Focus**：五条风险各有归属——行尾归一化在 Task 1 的 `read()`，触发分支与 action 白名单在 Task 1 第三条断言，命令顺序在 Task 1 第二条断言 + Task 3 第四条断言，Node 版本在 Task 1 两条断言，干净环境在 Task 4 Step 2。
- **Proportion**：计划约 1.5 倍于设计文档，代码块是测试与两个配置文件的原文（都是必须逐字确定的部分），没有替实现者写业务逻辑。
