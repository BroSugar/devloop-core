# PRD 审核把关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 devloop-core 加「PRD 上传 → 完善 → 审核 → 通过」的质量门，v1 做到「审核通过」为止，上传留适配器接口。

**Architecture:** 新增 `prds`/`prd_reviews` 两张表；服务端直接 `import platform/lib/ai.mjs` 同步执行 `refiner`/`prd-reviewer`（阻塞请求，与现有 `executeRun` 一致）；前端新增 PRD 视图。检查清单逐字落 `config/prd-checklist.yaml`。

**Tech Stack:** Node + PostgreSQL、`platform/lib/ai.mjs`（loadAi/resolveAgent/buildRequest/invoke）、React 19 + Vite + Tailwind v4、pnpm。

**Spec:** [docs/superpowers/specs/2026-11-25-prd-review-design.md](../specs/2026-11-25-prd-review-design.md)

## Global Constraints

- 契约在 `contracts/`：新表进 `contracts/db.v1.sql`；可写资源 `ETag: "v<integer>"` + `If-Match`，冲突 409。
- PRD 状态：`draft/refining/reviewing/approved/needs_revision/rejected`；审核 verdict：`pass/needs_revision/reject`。
- 检查清单 = 15 项（11 硬门 + 4 软门），逐字写进 `config/prd-checklist.yaml`，不得改写。
- `refiner` 与 `prd-reviewer` 是**两个独立角色**（禁止自审）。
- refine→review 最多 3 轮；agent 失败回退触发前状态、可重试；`refining/reviewing` 期间 PRD 锁定（编辑 409）。
- 同步执行（阻塞请求）；异步队列属 v1.1，不在本次。
- AI 沙箱默认 dry-run，真实 http 调用需 `DSH_PLATFORM_ALLOW_NETWORK=1`（`cli` 形态本地 agent 不受限）。
- 前端 data-testid 约定：新元素若被 `check.mjs` 断言需带 `data-testid`。

## Review Focus

1. 状态机不卡死：refine→review 每个过渡都有终态或回退（`reject`→rejected、agent 失败→回退可重试）→ Task 3 契约测试覆盖。
2. 审核可追溯：`prd_reviews` 钉住 `content_sha256`/`content_version`，refine 覆盖原文后仍能审计评审输入 → Task 3 契约测试覆盖。
3. 禁止自审：`refiner` 与 `prd-reviewer` 路由到不同角色（代码审查确认 `resolveAgent` 用了两个角色名）→ Task 3。
4. 循环上限：第 3 轮 `needs_revision` 后不再自动循环（需人工）→ Task 3 契约测试覆盖。
5. 前端不破坏现有 4 视图回归：新增 PRD 视图后 `check.mjs` 仍 18/18 → Task 4 回归。

---

### Task 1: 契约与配置（schema + 检查清单 + 角色/提示词）

**Files:**
- Modify: `contracts/db.v1.sql`
- Create: `config/prd-checklist.yaml`
- Modify: `config/agents.yaml`
- Create: `config/prompts/refine.md`
- Create: `config/prompts/prd-review.md`

**Interfaces:**
- Produces: 表 `prds`（`id/project_id/title/content/status/version/created_at/updated_at`）、`prd_reviews`（`id/prd_id/kind/status/verdict/findings/output/agent/sha256/content_sha256/content_version/created_at`）；`config/prd-checklist.yaml`；agent 角色 `refiner`、`prd-reviewer`。

- [ ] **Step 1: 加两张表到 `contracts/db.v1.sql`**

`prds` 与 `prd_reviews` 的 DDL 按 spec 数据模型（字段名与上表一致）；`prd_reviews.prd_id` 外键指向 `prds.id`；`status`/`kind`/`verdict` 用 TEXT（无 CHECK 约束，枚举靠应用层，与现有 `tasks.status` 一致）。

- [ ] **Step 2: 验证迁移可跑**

Run: `node server/index.mjs`（PG 已起，`DATABASE_URL` 指向 55432）
Expected: 服务启动、迁移无报错、`/api/v1/health` 返回 ok。

- [ ] **Step 3: 加检查清单 + 角色 + 提示词**

`config/prd-checklist.yaml`：15 项逐字（spec「检查清单」表格），每项 `{id, gate: hard|soft, text}`。
`config/agents.yaml`：加 `refiner`（provider 默认 openai-compatible、prompt `prompts/refine.md`）与 `prd-reviewer`（prompt `prompts/prd-review.md`）。
`config/prompts/refine.md`：让 agent 按清单补齐结构/口径/边界/异常路径，输出完整文档正文。
`config/prompts/prd-review.md`：让 agent 读清单逐项判定，输出 JSON `{verdict, findings:[{item, severity, problem, requiredFix}]}`。

- [ ] **Step 4: 验证配置可加载**

Run: `node server/index.mjs`（重启，seed 不报错）
Expected: 服务启动、seed 正常；`refiner`/`prd-reviewer` 能被 `loadAi` 读到（可临时用 `node platform/cli.mjs agents --project ledger-cli --role prd-reviewer` dry-run 确认，或人工确认无报错）。

- [ ] **Step 5: Commit**

```bash
git add contracts/db.v1.sql config/prd-checklist.yaml config/agents.yaml config/prompts/refine.md config/prompts/prd-review.md
git commit -m "feat(prd): 新增 prd 契约与检查清单、refiner/prd-reviewer 角色"
```

---

### Task 2: 仓储 + CRUD API

**Files:**
- Modify: `server/store.mjs`
- Modify: `server/api.mjs`
- Test: `server/test/prd-api.test.mjs`

**Interfaces:**
- Consumes: `prds`/`prd_reviews` 表（Task 1）。
- Produces: Store 方法 `upsertPrd(p)` / `getPrd(id)` / `listPrds(projectId)` / `updatePrd(id, patch, guard)`；`createPrdReview({prdId, kind, ...})` / `listPrdReviews(prdId)`。API 端点：`GET /api/v1/prds?projectId=`、`POST /api/v1/prds`、`GET|PUT /api/v1/prds/{id}`（PUT 乐观锁）、`GET /api/v1/prds/{id}/reviews`。

- [ ] **Step 1: 写失败契约测试**

在 `server/test/prd-api.test.mjs`（沿用 `pg-util.mjs` 建独立库）断言：POST 建 PRD → `GET /prds/{id}` 返回 ETag `"v1"` → PUT 带 `If-Match` 改 title 成功、版本 +1 → 无 `If-Match` 返回 409 → `GET /prds?projectId=` 列表过滤正确 → `GET /prds/{id}/reviews` 初始为空。

- [ ] **Step 2: 运行确认红**

Run: `node server/test/prd-api.test.mjs`
Expected: FAIL（路由不存在 / 404）。

- [ ] **Step 3: 实现 Store 方法 + API 端点**

`store.mjs`：新增 `upsertPrd`/`getPrd`/`listPrds`/`updatePrd`（updatePrd 用 `withTransaction` + 版本守卫，同 `updateTask`）；`createPrdReview`/`listPrdReviews`。`api.mjs`：新增上述 6 个路由，信封/错误码沿用 `ok/notFound/badRequest/conflict`。

- [ ] **Step 4: 运行确认绿**

Run: `node server/test/prd-api.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/store.mjs server/api.mjs server/test/prd-api.test.mjs
git commit -m "feat(prd): prd 仓储与 CRUD API"
```

---

### Task 3: refine / review 执行（agent 编排）

**Files:**
- Create: `server/prd/execute.mjs`
- Modify: `server/api.mjs`
- Test: `server/test/prd-review.test.mjs`

**Interfaces:**
- Consumes: Store 方法（Task 2）、`platform/lib/ai.mjs` 的 `loadAi/resolveAgent/buildRequest/invoke`、`config/prd-checklist.yaml`。
- Produces: `refinePrd(store, prdId, { invokeFn })` 与 `reviewPrd(store, prdId, { invokeFn })`——参数注入 `invokeFn` 便于测试 mock agent；真实调用时用 `platform/lib/ai.mjs` 的 `invoke`。二者写 `prd_reviews`（含 `content_sha256`/`content_version`）并推进 `prds.status`。API 端点：`POST /api/v1/prds/{id}/refine`、`POST /api/v1/prds/{id}/review`。

- [ ] **Step 1: 写失败测试**

在 `server/test/prd-review.test.mjs`（mock `invokeFn` 返回 canned agent 输出）断言：
1. `refine` 后 `prds.status=reviewing`、`prd_reviews` 多一条 `kind=refine`、其 `content_sha256` = refine 后 `prds.content` 的哈希。
2. `review`（verdict=pass）后 `prds.status=approved`。
3. `review`（verdict=needs_revision）后 `prds.status=needs_revision`；连发 3 轮后第 4 次触发被拒（循环上限）。
4. `review`（verdict=reject）后 `prds.status=rejected`。
5. `invokeFn` 抛错 → `prd_reviews.status=failed` 且 `prds.status` 回退到触发前。

- [ ] **Step 2: 运行确认红**

Run: `node server/test/prd-review.test.mjs`
Expected: FAIL（路由/函数不存在）。

- [ ] **Step 3: 实现 `server/prd/execute.mjs` + 端点**

`refinePrd`/`reviewPrd`：读 `prds` → 锁定状态（`refining/reviewing`）→ 调 `resolveAgent('refiner'|'prd-reviewer')` + `buildRequest` + `invoke` → 解析输出（review 解析 verdict+findings；refine 拿正文）→ 写 `prd_reviews`（计算 `sha256(output)` 与 `content_sha256`/`content_version`）→ 推进 `prds.status`（refine 回写 content 新版本）。`api.mjs` 加两个 POST 端点，从 `body` 透传可选的 `invokeFn` 覆盖（仅测试用，生产忽略）。

- [ ] **Step 4: 运行确认绿 + 回归**

Run: `node server/test/prd-review.test.mjs` 与 `node server/test/prd-api.test.mjs`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/prd/execute.mjs server/api.mjs server/test/prd-review.test.mjs
git commit -m "feat(prd): refine/review agent 编排与状态机"
```

---

### Task 4: 前端 PRD 视图

**Files:**
- Modify: `client/packages/api-client/src/index.js`
- Modify: `client/apps/web/src/App.jsx`
- Create: `client/apps/web/src/views/PrdView.jsx`
- Modify: `client/packages/ui/src/badge.jsx`
- Modify: `tools/visual/check.mjs`

**Interfaces:**
- Consumes: API 端点（Task 2/3）、`StatusBadge`。
- Produces: `api.prds/listPrd/getPrd/createPrd/updatePrd/refinePrd/reviewPrd/listPrdReviews`；`PrdView` 组件（列表 + 详情 + 触发完善/审核 + 查看 findings）；`StatusBadge` 对 `draft/refining/reviewing/needs_revision/approved/rejected` 的 tone 映射。

- [ ] **Step 1: api-client 加 prd 方法**

`packages/api-client/src/index.js` 加上述 7 个方法（POST/PUT 走 `request`，PUT 带 `ifMatch`）。

- [ ] **Step 2: 实现 PrdView + 头部入口**

`App.jsx`：头部加「PRD」按钮（图标 `FileText`，与「流程视图」「卡同步」并列），`view.name==='prd'` 渲染 `PrdView`。`PrdView.jsx`：列表（`StatusBadge` 状态 + 新建表单粘贴正文）→ 详情（读正文 + 按钮「完善」「审核」+ findings 列表 + 状态徽章）。状态过渡复用 `busy` 与 `hint`。

- [ ] **Step 3: StatusBadge 补 prd 状态映射**

`badge.jsx` 的 `TONE_BY_STATUS` 加：`draft/needs_revision→warning`、`refining/reviewing→info`、`approved→success`、`rejected→danger`。

- [ ] **Step 4: 回归 + 新增 check 断言**

`tools/visual/check.mjs` 加一条「PRD 视图」断言（切到 PRD 视图后，`data-testid=prd-empty` 或列表元素存在）。Run: `pnpm --dir client build` + `node tools/visual/check.mjs`（VISUAL_URL=8787）。
Expected: build 成功；check.mjs 原 18 条 + 新断言全绿。

- [ ] **Step 5: Commit**

```bash
git add client/packages/api-client/src/index.js client/apps/web/src/App.jsx client/apps/web/src/views/PrdView.jsx client/packages/ui/src/badge.jsx tools/visual/check.mjs
git commit -m "feat(prd): 前端 PRD 视图与状态徽章映射"
```
