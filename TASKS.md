# TASKS — 待办任务列表（机器可读）

> **给 AI 工具 / 代理的约定**（识别与推送都用这一套格式）：
> - 一行一个任务：`- [ ] \`ID\` | **优先级** | 标题 | 说明 / 关联文件`
> - 状态：`[ ]` 待办 → `[>]` 进行中（并注明 owner）→ `[x]` 完成
> - **推送新任务**：按同样格式追加一行，`ID` 取下一个未用的 `T-<数字>`（全文件唯一）
> - 优先级：`P0` 阻塞 / `P1` 尽快 / `P2` 常规 / `P3` 可选打磨
> - 上下文：代码地图见 [AGENTS.md](AGENTS.md)，原始背景见 [docs/backlog.md](docs/backlog.md)

## 未开始

### P2

- [ ] `T-1001` | **P2** | 流程画布：节点少时补 fit-to-content / 缩放控件（减少留白） | client/apps/web/src/views/FlowView.jsx（backlog #11）
- [ ] `T-1002` | **P2** | 前端 URL 深链：hash 路由，刷新/分享不回退到流程视图 | client/apps/web/src/App.jsx（backlog #10）
- [ ] `T-1003` | **P2** | PRD 接真实云平台 publish 适配器（重试/幂等/版本留痕） | server/prd/execute.mjs 的 publish 契约（v1.1）
- [ ] `T-1004` | **P2** | 正式镜像构建验证（node:24-alpine 拉取，docker/Dockerfile 三段） | docker/（backlog #7）
- [ ] `T-1005` | **P2** | PRD refine/review 的 invoke 加超时 + 中断 | server/prd/execute.mjs、platform/lib/ai.mjs

### P3

- [ ] `T-1006` | **P3** | 证据链 0 字节日志折叠/标注"空输出" | client/apps/web/src/views/CardView.jsx（backlog #12）
- [ ] `T-1007` | **P3** | CI 契约测试补 permissions 最小权限 + 收紧守卫正则 | server/test/ci-contract.test.mjs（backlog #8）
- [ ] `T-1008` | **P3** | 本地 verify 自动检测 PG 已起（否则提示 db:up） | package.json、docs（backlog #9）
- [ ] `T-1009` | **P3** | PRD POST /prds 校验 id 格式（PRD-*）+ 重复 id 去重 | server/api.mjs
- [ ] `T-1010` | **P3** | PRD findings 列改 JSONB；3 轮后提供 reset/abort 出口 | contracts/db.v1.sql、server/prd/execute.mjs
- [ ] `T-1011` | **P3** | check.mjs 的 prd-empty 断言健壮化；PrdView 缺 item 时兜底 | tools/visual/check.mjs、client/apps/web/src/views/PrdView.jsx
- [ ] `T-1012` | **P3** | resolveAgent 时断言 refiner 与 prd-reviewer 路由到不同 agent（防自审） | platform/lib/ai.mjs 或 server/prd/execute.mjs
- [ ] `T-1013` | **P3** | check.mjs 补"连线带方向标记"断言（当前只断言连线数量） | tools/visual/check.mjs
- [ ] `T-1014` | **P3** | 移除 React Flow hideAttribution（Pro 订阅特性，ToS 灰区） | client/apps/web/src/views/FlowView.jsx
- [ ] `T-1015` | **P3** | 流程节点显式 nodesDraggable={false}（查看器非编辑器，避免拖拽回弹） | client/apps/web/src/views/FlowView.jsx
- [ ] `T-1016` | **P3** | 边 id 加并行边去重后缀（当前 `${from}->${to}` 对并行边不唯一） | client/apps/web/src/views/FlowView.jsx

## 进行中

（空）

## 已完成

- [x] `T-0001` | — | 前端视觉改造：React Flow 流程视图 + 动态连线 + lucide 图标 + 深色主题统一 | merged（a4500e7）
- [x] `T-0002` | — | PRD 审核把关：完善/审核质量门 + 检查清单 + 前端视图 | merged（2d828f3）
- [x] `T-0003` | — | 代码地图 AGENTS.md | merged
- [x] `T-0004` | — | 前端界面截图（docs/images/） | merged
