# 前端视觉与流程视图改造设计

日期：2026-11-24
状态：已批准

## 意图

流程视图（`FlowView.jsx`）目前是手写静态 SVG：连线无动画、无方向箭头，也没有缩放/平移；
整体前端虽已是深色（`class="dark"` + `index.css` 的 oklch token + shadcn 风格组件），但**没有任何图标**，
各界面视觉细节不统一、缺少现代感。

目标不是"换肤"，而是：用开源图库重做流程视图并给连线加**动态效果**，同时引入图标、打磨深色主题，
把 4 个视图 + 顶部栏 + `packages/ui` 组件统一成同一套视觉语言。

## 目标

1. 流程视图用 `@xyflow/react`（React Flow）重写：缩放 / 平移 / 画布居中。
2. 连线动态效果——**方向**与**状态**两个视觉通道都要有，且二者**可区分**（这是用户明确要求）。
3. 引入 `lucide-react` 图标，覆盖头部、按钮、视图标题、状态徽章、空状态、节点。
4. 打磨现有 Tailwind v4 深色 token，统一 4 视图 + 头部 + 组件。
5. 保持 `tools/visual/check.mjs` 视觉验收兼容（`data-testid` 不丢）。

## 非目标

- 不改服务端 API / 数据形状（`nodes`/`edges` 已够用）。
- 不做 URL 路由 / 深链（backlog #10）。
- 不做节点拖拽的持久化（是查看器，不是编辑器；可允许拖拽但不落库）。
- 不做浅色主题。
- 不引入整套主题包 / 设计系统（如 shadcn themes、Radix Colors）。
- 不做轮询 / 实时刷新：异步执行与 SSE 是 v1.1（README）；「running 脉冲」只是对**已加载**状态的 CSS 动画，不加拉取循环。
- 不改 AI / 门禁 / 卡同步等业务逻辑。

## 反目标（即使技术上能跑也算失败）

- **方向与状态混在一个视觉通道里**（比如用颜色同时表达方向和状态）——用户会分不清，这是本次要避免的核心。
- 为"现代感"堆砌动画，导致卡顿或闪眼。
- `tools/visual/check.mjs` 回归变红。
- 推翻现有 shadcn 组件体系换用另一套组件库。

## 约束

| 约束 | 依据 |
| --- | --- |
| React 19 + Vite 8 + Tailwind v4 + pnpm workspace | 现状 |
| npm 源可访问 | 已确认 `registry.npmjs.org` 返回 200 |
| 服务端 flow 形状固定 | `node {id, kind, label, status, x, y, requirementId, taskId?, runId?}`、`edge {from, to}`（from/to 为 node id） |
| `@xyflow/react` v12 支持 React 19；容器需确定高度 | 图库本身要求，不能再像现在 absolute 铺开 |
| 保留 `data-testid` | `check.mjs` 依赖 `task-node` / `req-node` / `evidence-item`，浮动标签依赖 `getByLabel('标题')` |

## 方案

| 方案 | 内容 | 取舍 |
| --- | --- | --- |
| **A（采用）** | React Flow + lucide-react + 就地打磨现有深色 token，统一全前端 | 加 2 个依赖、FlowView 重写量最大，但正好同时满足三个诉求 |
| B | 不引图库，手写 SVG 加 CSS 流动动画 + lucide + 打磨主题 | 改动最小，但违背"用开源工具优化交互" |
| C | D3 / AntV X6 | D3 手写太多；X6 偏画布编辑器、对数据流展示过重 |

选 A。

## 怎么做（已定部分）

### 1. 依赖

`client/apps/web/package.json` 增加 `@xyflow/react`（v12）与 `lucide-react`。

### 2. 主题（`index.css` 就地打磨）

- 保持 oklch + Tailwind v4 `@theme inline` 结构，只调值 + 补 token，不换方案。
- 层次更分明：`background` 更深一点、`card` 与背景拉开、`border` 弱化（降噪）、`muted` 用于悬停/次要。
- `primary` 保持蓝系，只做交互强调（按钮 / 焦点 / 链接）。
- **新增 `--color-info`（青色系，与 primary 蓝区分）**，供"就绪/info"这类状态使用，
  避免"状态蓝"和"交互蓝"撞色；`badge.jsx` 的 `info` tone 改指 `info` 色。
- 语义色四件套：`success`(绿) / `danger`(红) / `warning`(琥珀) / `info`(青)。
- 统一圆角、`focus-visible` ring、hover 亮度。

### 3. 图标（lucide-react）

类别固定，具体图标名可由构建者微调：

| 位置 | 建议图标 |
| --- | --- |
| 品牌/logo | `Workflow` 或 `GitBranch` |
| 视图切换：流程视图 / 卡同步 | `Workflow` / `GitCompareArrows` |
| 访问令牌输入 | `KeyRound` |
| 能力徽章 fs/term/agent | `Folder` / `Terminal` / `Bot` |
| 按钮：运行 / 保存 / 返回 | `Play` / `Save` / `ArrowLeft` |
| 卡同步按钮：预览导出 / 导出 / 预览导入 / 导入 | `Eye` / `FileUp` / `Eye` / `FileDown` |
| 视图标题：证据 / 卡 | `ShieldCheck` / `FileText` |
| 节点：需求 / 任务 | `ListChecks` / `SquareCheckBig` |
| 空状态 | `Inbox` |

### 4. 流程视图（FlowView 重写为 React Flow）

- 容器给确定高度（如 `h-[calc(100dvh-…)]`），挂 `fitView` 居中。
- 服务端 `x/y` → `node.position`（保留服务端分层布局，不另写自动布局）。
- 自定义节点（`devloop` 类型）：卡片 + kind 图标 + `StatusBadge` + 状态色 accent（左边条或圆点），保留 `data-testid`。
- 画布点缀：`<Background>`（点阵）+ `<Controls>`（缩放/居中）；`MiniMap` 默认不加（小 DAG 无收益）。

### 5. 动态连线规格（核心）

两条**正交**视觉通道，恒定开启：

| 通道 | 表达方式 | 说明 |
| --- | --- | --- |
| **方向** | 箭头（`markerEnd` 指向目标）+ 流动虚线（marching dashes 从源到目标） | 用"形状 + 运动" |
| **状态** | 边颜色 = **源节点**状态（`passed` 绿 / `failed` 红 / `running` 琥珀并脉冲 / `blocked`·`pending` 灰 / `ready` 青） | 用"颜色" |

方向靠形状/运动、状态靠颜色，互不干扰——这满足"数据往哪流"与"任务状态"都保留、且"两条线视觉区分开"。

边颜色的具体取值：`req → task` 边查**需求**状态（`accepted` 绿 / `ready` 青 / `draft` 灰），`task → task` 边查**源任务**状态——两者都走 `TONE_BY_STATUS` 统一映射，保证一致。

节点状态色、边状态色与 `StatusBadge` 的 `TONE_BY_STATUS` 共用同一映射。

### 6. 统一其余界面

- 头部：品牌图标、项目下拉图标、视图按钮图标、token 输入图标、能力徽章图标。
- `CardView` / `EvidenceView` / `SyncView`：统一 Card 用法、加图标标题、按钮图标、空状态图标+文案。
- `StatusBadge`：加小圆点强化状态色。

### 7. 兼容性

- 保留 `data-testid="task-node" / "req-node" / "evidence-item"`，浮动标签结构不变 → `check.mjs` 无需改动。
- 改造完成后，用 `node tools/visual/capture-docs.mjs` 重新生成 `docs/images/` 四张界面插图，保持文档与新版 UI 一致（服务端需先起、前端已 build）。

## 留给构建者的判断

- 具体 oklch 色值、圆角/阴影数值的微调。
- 具体 lucide 图标名（在固定类别内）。
- 边类型选 `default`(贝塞尔) 还是 `smoothstep`。
- 节点是否允许拖拽（默认允许、但不持久化）。
- 运行中脉冲动画的具体实现（CSS keyframe 或 React Flow `animated` + 颜色叠加）。
