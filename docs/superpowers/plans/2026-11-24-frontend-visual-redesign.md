# 前端视觉与流程视图改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 React Flow 重做流程视图（连线动态：方向+状态两通道），引入 lucide-react 图标与打磨后的深色主题，统一整个前端界面。

**Architecture:** 前端是 pnpm workspace 的 React 19 + Vite 8 + Tailwind v4 单页应用。改动集中在 `client/apps/web/src` 与 `client/packages/ui`，服务端 API/数据形状不动。流程视图由手写 SVG 换成 `@xyflow/react`，节点/边状态色与 `StatusBadge` 共用同一映射。

**Tech Stack:** React 19、Vite 8、Tailwind v4、@xyflow/react v12、lucide-react、pnpm。

**Spec:** [docs/superpowers/specs/2026-11-24-frontend-visual-redesign-design.md](../specs/2026-11-24-frontend-visual-redesign-design.md)

## Global Constraints

- React 19 + Vite 8 + Tailwind v4 + pnpm workspace，不降级不换方案。
- `@xyflow/react` v12（支持 React 19）；图标用 `lucide-react`。
- 保留 `data-testid="task-node" / "req-node" / "evidence-item"`；浮动标签 `getByLabel('标题')` 结构不变 → 现有 `check.mjs` 断言不能红。
- 连线两通道正交：**方向**=箭头(`markerEnd`)+流动虚线(`animated`)，**状态**=颜色；状态色查 `TONE_BY_STATUS`（`req→task` 用需求状态，`task→task` 用源任务状态）。
- 不改服务端 API/数据形状；不做轮询/实时刷新（v1.1）；不做浅色；不引入整套主题包。
- 状态→tone 映射（与现有 `badge.jsx` 的 `TONE_BY_STATUS` 一致）：`passed/accepted/synced→success`、`running/db_ahead/file_ahead/db_only/file_only→warning`、`failed/conflict/untracked→danger`、`ready→info`、其余→neutral。

## Review Focus

1. 切换项目后流程视图重新渲染、不残留旧 DAG —— 现有 `check.mjs`「切换项目后 DAG 重新渲染」回归（Task 2）。
2. 重写后连线仍在且带方向标记 —— 新增 `check.mjs` 断言「流程连线渲染」`>= 3` 条 `.react-flow__edge`（Task 2，红→绿）。
3. 任务节点仍可点击打开卡详情 —— 现有 `check.mjs`「卡详情：任务目标字段」回归（Task 2）。
4. running 状态出现时是琥珀色脉冲而非绿/红 —— 无现成 running 数据，无法自动化；Task 2 代码审查确认 `statusStroke` 映射 + `running` 加 pulse class，Task 4 截图人工核。
5. 新增 `--color-info` 不破坏 ready/info 徽章显示 —— 现有 `check.mjs`「能力徽章可见」「卡同步：状态徽章存在」回归（Task 1/2/3）。

---

### Task 1: 视觉基座（依赖 + 深色主题打磨 + 状态色导出）

**Files:**
- Modify: `client/apps/web/package.json`
- Modify: `client/apps/web/src/index.css`
- Modify: `client/packages/ui/src/badge.jsx`
- Modify: `client/packages/ui/src/index.js`

**Interfaces:**
- Produces: 依赖 `@xyflow/react`、`lucide-react`；CSS 变量 `--color-info`（青，与 `--color-primary` 蓝区分）；`@devloop/ui` 导出 `TONE_BY_STATUS`（`status → tone`）与 `TONE_STROKE`（`tone → 'var(--color-*)'`，取值 `success→--color-success`、`danger→--color-danger`、`warning→--color-warning`、`info→--color-info`、`neutral→--color-border`）。

- [ ] **Step 1: 加依赖**

在 `package.json` 的 `dependencies` 加 `"@xyflow/react": "^12"`、`"lucide-react": "^0"`。运行 `pnpm --dir client install`。

- [ ] **Step 2: 验证依赖可解析**

Run: `pnpm --dir client build`
Expected: 构建成功（暂无代码引用新包）。

- [ ] **Step 3: 打磨深色 token + 新增 info 色**

在 `index.css` 的 `@theme inline` 内：微调 `background/card/border/muted` 层次（背景更深、card 与背景拉开、border 弱化）；新增 `--color-info: oklch(0.70 0.10 220)`（青系，区别于 primary 蓝）。保持 oklch 结构不变。

- [ ] **Step 4: badge.jsx 的 info tone 指向 info 色 + 导出映射**

`info` tone 从 `border-primary/40 bg-primary/10 text-primary` 改为 `border-info/40 bg-info/10 text-info`。新增导出 `TONE_BY_STATUS`（现为模块私有）与 `TONE_STROKE`（见 Interfaces）。在 `packages/ui/src/index.js` 补导出这两个。

- [ ] **Step 5: 验证 + 截图目检**

Run: `pnpm --dir client build` 与 `node tools/visual/check.mjs`
Expected: build 成功；check.mjs 全绿（「能力徽章可见」「状态徽章存在」等不受影响）。`capture-docs.mjs` 截图目检新 token 层次。

- [ ] **Step 6: Commit**

```bash
git add client/apps/web/package.json client/pnpm-lock.yaml client/apps/web/src/index.css client/packages/ui/src/badge.jsx client/packages/ui/src/index.js
git commit -m "feat(ui): 打磨深色主题并新增 info 色，导出状态色映射"
```

---

### Task 2: 流程视图重写（React Flow + 动态连线）

**Files:**
- Create: `client/apps/web/src/views/FlowNode.jsx`
- Modify: `client/apps/web/src/views/FlowView.jsx`
- Modify: `tools/visual/check.mjs`

**Interfaces:**
- Consumes: `panel.flow.nodes`/`panel.flow.edges`（服务端形状）、`onOpenTask(taskId)`、`@devloop/ui` 的 `StatusBadge`/`TONE_BY_STATUS`/`TONE_STROKE`（Task 1）。
- Produces: `FlowNode`（React Flow 自定义节点，`type:'devloop'`）、`toRfNodes(nodes)`、`toRfEdges(edges, byId)`、`statusStroke(status)`（返回 `TONE_STROKE[TONE_BY_STATUS[status] ?? 'neutral']`）。

- [ ] **Step 1: 写失败断言**

在 `tools/visual/check.mjs` 的流程视图段（`shot('01-flow.png')` 之后、切换项目之前）加入：

```js
const edgeCount = await page.locator('.react-flow__edge').count();
check('流程连线渲染', edgeCount >= 3, `edges=${edgeCount}`);
```

- [ ] **Step 2: 运行确认红**

Run: `node tools/visual/check.mjs`（服务端已起）
Expected: 「流程连线渲染」FAIL（当前手写 SVG 无 `.react-flow__edge`）。

- [ ] **Step 3: 写 `FlowNode.jsx`**

自定义节点组件：props 为 `{ data }`，`data` 即服务端 node（`kind/label/status/taskId`）。渲染为卡片：`kind` 图标（`requirement`→`ListChecks`、`task`→`SquareCheckBig`）+ `label` + `StatusBadge` + 状态色左边条（`TONE_STROKE[TONE_BY_STATUS[status]]`）。根元素保留 `data-testid={kind==='task'?'task-node':'req-node'}`，`task` 节点 `onClick` 调 `data.onOpenTask(taskId)`（通过 `data` 传入回调）。

- [ ] **Step 4: 重写 `FlowView.jsx`**

`import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react';` + `import '@xyflow/react/dist/style.css';`。容器给确定高度（`h-[calc(100dvh-9rem)]`，`main` 内已 `p-4`）。`toRfNodes` 把服务端 `x/y` 映射为 `position`、`type:'devloop'`、`data:{...node, onOpenTask}`。`toRfEdges` 每条边：`animated:true`、`markerEnd:{type:MarkerType.ArrowClosed}`、`style:{stroke:statusStroke(byId.get(edge.from).status)}`；`source` 为 `running` 时给 path 加 pulse class。挂 `<Background />`、`<Controls />`、`fitView`。`nodeTypes={{ devloop: FlowNode }}`。空态（无节点）保留原占位文案。

- [ ] **Step 5: 运行确认绿**

Run: `node tools/visual/check.mjs`
Expected: 全绿（新增「流程连线渲染」PASS；「切换项目后 DAG 重新渲染」「卡详情」等回归 PASS）。

- [ ] **Step 6: 构建 + 截图目检**

Run: `pnpm --dir client build` + `node tools/visual/capture-docs.mjs`
Expected: build 成功；`flow-view.png` 显示带箭头与流动虚线的连线、按状态着色。

- [ ] **Step 7: Commit**

```bash
git add client/apps/web/src/views/FlowNode.jsx client/apps/web/src/views/FlowView.jsx tools/visual/check.mjs
git commit -m "feat(flow): 用 React Flow 重做流程视图，连线加方向与状态动态效果"
```

---

### Task 3: 图标与其余界面统一

**Files:**
- Modify: `client/apps/web/src/App.jsx`
- Modify: `client/apps/web/src/views/CardView.jsx`
- Modify: `client/apps/web/src/views/EvidenceView.jsx`
- Modify: `client/apps/web/src/views/SyncView.jsx`

**Interfaces:**
- Consumes: `lucide-react`（Task 1）；图标名按 Spec 第 3 节表（类别固定，具体名可微调）。

- [ ] **Step 1: 头部图标（App.jsx）**

品牌前加 `Workflow` 图标；「流程视图」按钮加 `Workflow`、「卡同步」加 `GitCompareArrows`；token 输入左侧加 `KeyRound`；能力徽章 `fs/term/agent` 加 `Folder`/`Terminal`/`Bot`。

- [ ] **Step 2: 三视图图标 + 统一**

`CardView`：返回按钮 `ArrowLeft`、运行按钮 `Play`、保存按钮 `Save`、标题加 `FileText`；`EvidenceView`：返回按钮 `ArrowLeft`、标题加 `ShieldCheck`；`SyncView`：返回按钮 `ArrowLeft`、四个动作按钮分别加 `Eye`/`FileUp`/`Eye`/`FileDown`；各空状态加 `Inbox` 图标 + 文案。

- [ ] **Step 3: 回归 + 构建**

Run: `node tools/visual/check.mjs` + `pnpm --dir client build`
Expected: check.mjs 全绿（浮动标签「标题」、`evidence-item` 点击等不受影响）；build 成功。

- [ ] **Step 4: Commit**

```bash
git add client/apps/web/src/App.jsx client/apps/web/src/views/CardView.jsx client/apps/web/src/views/EvidenceView.jsx client/apps/web/src/views/SyncView.jsx
git commit -m "feat(ui): 引入 lucide 图标并统一头部与三视图视觉"
```

---

### Task 4: 重新生成截图 + 全量回归收口

**Files:**
- Regenerate: `docs/images/flow-view.png`、`docs/images/card-view.png`、`docs/images/evidence-view.png`、`docs/images/sync-view.png`

- [ ] **Step 1: 重新生成四张界面插图**

Run: `node tools/visual/capture-docs.mjs`（服务端已起、前端已 `pnpm build`）
Expected: 四张 png 更新为新版 UI。

- [ ] **Step 2: 全量回归**

Run: `pnpm --dir client build` + `node tools/visual/check.mjs` + `npm run verify`
Expected: 前端 build 成功、check.mjs 全绿、后端契约测试全绿（本次未动后端，仅 sanity）。

- [ ] **Step 3: 截图目检**

用 read_image 目检四张图：连线流动/方向、状态色、图标、深色层次均符合 Spec。

- [ ] **Step 4: Commit**

```bash
git add docs/images/flow-view.png docs/images/card-view.png docs/images/evidence-view.png docs/images/sync-view.png
git commit -m "docs: 更新前端界面插图以匹配新版视觉"
```
