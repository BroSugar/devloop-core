# devloop-core · 代码地图（Code Map）

> 本文件面向后续接入本仓库的 AI 工具 / 开发者：先读这里，再按需深入 `README.md` 与 `docs/0x-*.md`。
> 所有标识符（函数名、表名、端点、环境变量）均与源码逐字一致。

## 0. 一句话

**devloop-core 是「配置驱动的自动化开发平台」**：把 `需求卡 → 任务卡 DAG → 隔离实现 → 统一门禁 → 证据归档` 做成与仓库无关的内核。
仓库差异、技术栈差异、AI 供应商差异**全部走配置**，不改内核代码。服务端负责 API/存储/执行；客户端（Web/桌面）只做卡编辑与证据查看。

---

## 1. 架构总览

```
┌────────────────────────── platform/（内核，不含任何项目名/模型名/技术栈名） ──────────────────────────┐
│  cli.mjs            统一 CLI 入口（projects/doctor/plan/new-*/prepare/run/agents/archive-*）      │
│  lib/config.mjs     分层配置解析 + 插值 + 来源追踪（每叶子值记录 sources）                          │
│  lib/plan.mjs       卡校验 + DAG 分层（无环、写域落盘、重叠检测）                                    │
│  lib/policy.mjs     写域（write/read/deny）+ 预算（文件数/行数）                                     │
│  lib/runtime.mjs    子进程（shell:true + 文件重定向）+ git worktree + 门禁解析/执行                  │
│  lib/evidence.mjs   证据归档（manifest + sha256 + archive/index.jsonl）+ archive-verify            │
│  lib/ai.mjs         provider/agent 适配（openai-compatible / anthropic / cli）                     │
│  lib/template.mjs   卡模板（config/templates/<t>/<kind>.yaml.tpl）                                  │
│  lib/yaml.mjs       零依赖 YAML 子集解析器                                                          │
└───────────────────────────────────────────▲──────────────────────────────────────────────────────────┘
                                            │ 共享（server/cards/yaml.mjs 直接 re-export 此 parser）
┌────────────────────────── server/（Node + PostgreSQL）──────────────────────────────────────────────┐
│  index.mjs          建连接池 → migrate → seed → listen（http://127.0.0.1:8787）                    │
│  http.mjs           HTTP 层：信封 {data,meta}/{error,meta}、Bearer 鉴权、静态资源、请求体             │
│  api.mjs            业务端点（约 18 条 path / 22 个 method 操作）                                     │
│  db.mjs             pg 连接池 + migrate（读 contracts/db.v1.sql）+ withTransaction                  │
│  store.mjs          仓储层（项目/需求/任务/DAG 状态推导/运行/证据/事件/卡同步/agent 配置）              │
│  seed.mjs           每次启动从 projects/ + repos/ + archive/ 导入 PG（幂等）                        │
│  pipeline/validate.mjs  执行前静态卡校验（validateCards）                                             │
│  pipeline/execute.mjs   执行期编排（executeRun：worktree → 变更 → 写域/预算 → 门禁 → 证据）            │
│  cards/{render,sync,yaml}.mjs  卡规范化+哈希、三方比较同步、YAML 薄封装                               │
│  test/*.test.mjs    api / cardsync / ci-contract 契约测试（每个测试文件建独立库）                     │
└───────────────────────────────────────────▲──────────────────────────────────────────────────────────┘
                                            │ HTTP + Bearer（ETag/If-Match 乐观锁）
┌────────────────────────── client/（pnpm workspace · React 19 + Vite）───────────────────────────────┐
│  apps/web           单页应用：App.jsx（状态机）+ views/{Flow,Card,Evidence,Sync}View.jsx            │
│  packages/api-client  唯一 API 出口（api 对象 + token 管理）                                          │
│  packages/ui         shadcn 风格组件 + 浮动标签表单件                                                  │
│  packages/shell      壳适配器契约（browser 全降级 / tauri 走 IPC，见 contracts/ipc.v1.md）            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘

contracts/  唯一事实来源（api.v1.yaml / db.v1.sql / config.schema.v1.json / agent.schema.v1.json / ipc.v1.md）
config/     分层配置（platform.yaml 默认 + presets/ 栈预设 + providers.yaml + agents.yaml + prompts/ + templates/）
projects/   项目配置（order-cancel / ledger-cli / demo-clamp）
samples/    示例仓库（order-cancel-pilot = 内核早期原型；demo-clamp）
repos/      bootstrap 生成的被管仓库外部 checkout（gitignore，不内嵌）
archive/    证据包（manifest + index.jsonl）
```

---

## 2. 顶层目录地图

| 目录/文件 | 作用 | 关键文件 |
| --- | --- | --- |
| `platform/` | 内核（CLI + 8 个 lib 模块），无外部项目/模型/栈名 | `cli.mjs`、`lib/*.mjs` |
| `server/` | Node + PostgreSQL 服务端（API/存储/执行） | `index.mjs`、`api.mjs`、`store.mjs`、`pipeline/*` |
| `client/` | 前端 pnpm workspace | `apps/web`、`packages/{ui,api-client,shell}` |
| `contracts/` | 契约包，服务端与客户端的**唯一事实来源** | `api.v1.yaml`、`db.v1.sql`、`ipc.v1.md` |
| `config/` | 分层配置 + 提示词 + 卡模板 | `platform.yaml`、`presets/*`、`providers.yaml`、`agents.yaml` |
| `projects/` | 每个接入项目的 `project.yaml`（+ 平台侧卡） | `*/project.yaml`、`ledger-cli/spec|tasks/*` |
| `samples/` | 被 bootstrap 复制成独立 git 仓库的样例 | `order-cancel-pilot/`、`demo-clamp/` |
| `repos/` | 被管仓库外部 checkout（bootstrap 生成，gitignore） | — |
| `worktrees/` | 任务隔离工作区（运行时生成，gitignore） | — |
| `runs/` | CLI 执行运行目录（gitignore） | — |
| `archive/` | 证据包归档（gitignore） | `index.jsonl` |
| `data/` | 运行时数据（证据文件落盘），gitignore | `evidence/` |
| `scripts/` | `bootstrap.mjs`（samples → repos） | — |
| `docker/` | `Dockerfile`（3 段）、`Dockerfile.dev`、`entrypoint.sh` | — |
| `tools/visual/` | 视觉验收 + 文档截图（playwright-core + 系统 Chrome） | `check.mjs`、`capture-docs.mjs` |
| `docs/` | 主题文档 + backlog | `01-06-*.md`、`backlog.md` |
| `compose.yaml` | postgres / api(dev) / api-prod | — |

---

## 3. 核心概念 / 术语

| 术语 | 含义 | 落点 |
| --- | --- | --- |
| 需求卡（requirement） | 一条需求，含 `acceptance`（每条有 `verify_by` 指向测试文件） | `requirements` 表 / `spec/*.yaml` |
| 任务卡（task） | 一个实现单元，含 `scope.write/read/deny`、`verify`、`depends_on` | `tasks` 表 / `tasks/*.yaml` |
| DAG | 需求卡 → 任务卡的有向无环图（服务端 `computeDag` Kahn 分层） | `dag_layer` |
| 门禁（gates） | `build / lint / test` 三段，命令来自 preset，顺序固定短路执行 | `config/presets/*.yaml` |
| 写域（scope） | 任务只能改 `write`，禁改 `deny`（deny 优先），diff 逐文件校验 | `policy.mjs`、`task_scope` |
| 判据先行 | 验收测试先写进仓库并跑红，`verify_by` 指向它 | docs/01 |
| 证据包（evidence） | 每次执行产物：`changes.txt`/`diff.patch`/`NN-*.log`/`result.json` + `manifest.json`（每条 sha256） | `archive/<p>/<req>/<task>/attempt-<n>/` |
| 卡同步（card sync） | DB 副本 ↔ 仓库 YAML 的**三方比较**（dbSha/fileSha/base） | `cards/sync.mjs`、`card_sync` 表 |
| 乐观锁 | 可写资源 `ETag: "v<integer>"`，更新带 `If-Match`，冲突 409 | `api.mjs` |
| 双写边界 | 配置=仅服务端；卡=客户端（API）；运行/证据=仅服务端 | `contracts/README.md` |

---

## 4. 关键数据流

### 4.1 CLI 执行（`platform/cli.mjs`，内核侧）

```
doctor → loadConfig+resolve（分层配置）→ 校验仓库/分支/3 个角色路由/模板
plan   → planProject（卡校验 + DAG）→ writeGraph（_graph.json）
prepare→ ensureRepo → prepareWorktree（worktrees/<p>/<t>，分支 task/<p>/<t>）
run    → 变更采集（git status/diff）→ checkChanges+checkBudget（写域/预算）
       → resolveVerify+runVerify（门禁三段）→ commitAll → mergeInto（--no-ff）
       → 主仓复验（再跑门禁）→ 失败 resetTo 回滚 → archiveRun（证据）
run --all → 拓扑排序后逐卡 run，任一失败即停
```

### 4.2 服务端执行（`POST /api/v1/tasks/{id}/runs`）

```
api.mjs：getTask → 拒绝 human-only → validateCards（静态校验）
       → 校验 localOverride（禁止 openai-compatible/anthropic 出网）
       → executeRun → 202 accepted(run)
pipeline/execute.mjs：createRun(queued) → 建 evidence 目录
       → prepareWorktree → 采集变更 → checkChanges/checkBudget → 违规即 fail
       → resolveVerify（verify.ref → gates 或裸命令）→ runLogged 逐阶段 → 写 NN-*.log
       → writeResult(result.json) → finishRun（recomputeStatuses + run.finished 事件）
```

### 4.3 卡同步（`GET/POST /projects/{p}/card-sync/*`）

```
computeSyncState：对每张卡比 dbSha / fileSha / baseDbSha / baseFileSha：
  synced | db_ahead(导出) | file_ahead(导入) | conflict(人工) | db_only | file_only | untracked
导出：renderers[kind](card) → 写前 roundtrip 自检 → 原子写（tmp+rename）→ 更新基线
导入：parseYamlFile → applyCard → 更新基线
只单边变更才自动化，双边一律 conflict 停下（见 docs/05）
```

---

## 5. 模块级代码地图

### 5.1 `platform/`（内核）

| 文件 | 关键导出 | 职责/要点 |
| --- | --- | --- |
| `cli.mjs` | （入口，无导出） | **顶层立即执行 dispatch，import 即触发命令副作用**；子命令见下表 |
| `lib/config.mjs` | `PLATFORM_ROOT`, `loadConfig`, `resolve`, `renderVars`, `interpolate`, `readYaml`, `listProjects`, `loadProjectRaw` | 四层合并 `defaults→preset→project→CLI`；`deny_write` 跨层 concat 去重；`{{a.b}}`/`{{env.NAME}}` 插值 |
| `lib/yaml.mjs` | `parseYaml` | 零依赖 YAML 子集（block 标量、内联数组、布尔/null/数字），不支持锚点/别名 |
| `lib/plan.mjs` | `AUTONOMY`, `REQ_STATUS`, `loadTaskCards`, `taskDeps`, `validateRequirement`, `validateTask`, `planProject`, `writeGraph`, `formatPlan` | 任务 id 强制 `^T-\d+$`；写域重叠且无依赖→错误，已串行→警告 |
| `lib/policy.mjs` | `normalizePath`, `globToRegExp`, `matchesAny`, `staticPrefix`, `mayOverlap`, `checkChanges`, `checkBudget` | deny 优先于 write；⚠️ `checkBudget` 只校验文件数，`max_diff_lines` 未被真正校验 |
| `lib/runtime.mjs` | `runCaptured`, `runLogged`, `tailFile`, `git`, `ensureRepo`, `worktreePath`, `prepareWorktree`, `removeWorktree`, `changedFiles`, `diffText`, `commitAll`, `mergeInto`, `resetTo`, `resolveVerify`, `runVerify` | 子进程 `shell:true` + 文件重定向（沙箱禁管道）；`resolveVerify` 把 `verify.ref` 解析为 gate/裸命令 |
| `lib/evidence.mjs` | `archiveRun`, `readIndex`, `verifyArchive`, `sha256File` | `archive/<p>/<req>/<task>/attempt-<n>/`；manifest `schema=evidence/v1`；`index.jsonl` 追加式 |
| `lib/ai.mjs` | `loadAi`, `resolveAgent`, `promptPath`, `buildRequest`, `invoke`, `describe` | 路由优先级 `by_project > by_role > default`；`DSH_PLATFORM_ALLOW_NETWORK=1` 才真发请求 |
| `lib/template.mjs` | `listTemplates`, `templatePath`, `renderTemplate`, `instantiate` | 模板名 `<t>/<kind>.yaml.tpl`；整行占位符做缩进感知替换 |

**CLI 子命令全集**（`cli.mjs` 的 dispatch）：

| 命令 | 处理函数 | 链路要点 |
| --- | --- | --- |
| `projects` | `cmdProjects` | listProjects → loadConfig/resolve → 打印 stack/cards.mode/repo_path |
| `doctor` | `cmdDoctor` | 校验仓库/分支/工作区 + 3 角色路由 + 模板存在性 |
| `plan` | `cmdPlan` | planProject → writeGraph |
| `new-task` / `new-requirement` | `cmdNew` | template.instantiate → 回读 validate |
| `prepare` | `cmdPrepare` | ensureRepo → prepareWorktree |
| `run` / `run --all` | `cmdRun` / `cmdRunAll` | 完整执行闭环（见 4.1） |
| `agents` | `cmdAgents` | 三角色 dry-run 打印请求（不发请求不花钱） |
| `archive-index` / `archive-verify` | `cmdArchiveIndex` / `cmdArchiveVerify` | 证据索引 / 全量哈希校验 |

### 5.2 `server/`

| 文件 | 关键导出 | 职责/要点 |
| --- | --- | --- |
| `index.mjs` | — | 建池 → `migrate`（读 db.v1.sql）→ `seedAll` → listen；迁移失败重试 10 次 |
| `http.mjs` | `createServer` | 信封、Bearer 鉴权（health 免鉴权）、静态资源（`client/apps/web/dist` + `contracts/` 可下载） |
| `db.mjs` | `ROOT`, `DATA_DIR`, `EVIDENCE_DIR`, `DEFAULT_DATABASE_URL`, `createPool`, `migrate`, `withTransaction`, `num`, `apiVersion` | `DATABASE_URL` 默认 `postgres://devloop:devloop@127.0.0.1:5432/devloop` |
| `api.mjs` | `createApi`（返回 `{routes, handle}`） | 端点全集见 5.2b；`raw:true` 的路由返回原始文本 |
| `store.mjs` | `class Store` | 唯一业务状态来源；**仅 `updateRequirement`/`updateTask` 用事务**，其余单条 SQL |
| `seed.mjs` | `seedAll` | 从 projects/ + repos/ + archive/ 导入；首次导入 `prefer:'force'`（迁移），否则 safe |
| `pipeline/validate.mjs` | `validateCards` | 执行前静态校验（AC `verify_by` 文件存在、verify/scope 非空、deps 存在、写域可落盘、DAG 无环、重叠须串行） |
| `pipeline/execute.mjs` | `executeRun`, `cfgFor`, `registerEvidence`, `writeResult` | 执行编排 + 证据落库（见 4.2）；**不做自动合并**（v1.1） |
| `cards/render.mjs` | `canonicalRequirement`, `canonicalTask`, `hashOf`, `sha256Bytes`, `renderRequirement`, `renderTask`, `renderers`, `canonicalizers` | **规范化形式就是冲突检测的基准** |
| `cards/sync.mjs` | `computeSyncState`, `exportCards`, `importCards` | 三方比较 + 原子导出 + roundtrip 自检 |
| `cards/yaml.mjs` | `parseYaml`（re-export）, `parseYamlFile` | 薄封装 `platform/lib/yaml.mjs` |
| `test/api.test.mjs` 等 | — | 契约测试，每个测试文件建独立库跑完删除 |

**5.2b · API 端点分组**（`api.mjs`，均 `/api/v1/*`）：

- `GET /health`（免鉴权，返回 counts）
- `GET /projects`、`POST /projects`（v1 只校验不注册，返回 400）
- `GET /projects/{id}`、`/projects/{id}/config`、`/projects/{id}/requirements`、`/projects/{id}/panel`
- `GET|PUT /requirements/{id}`（PUT 乐观锁）、`GET /requirements/{id}/dag`
- `GET|PUT /tasks/{id}`（PUT 乐观锁）、`GET /tasks/{id}/runs`、`POST /tasks/{id}/runs`（触发执行）
- `GET /runs/{id}`、`GET /runs/{id}/evidence`
- `GET /evidence/{id}/content`（raw，带 `x-evidence-sha256`）
- `GET /agent-config`（下发 agent schema/policy，`readonly:true`）
- `GET /events?projectId=&since=&limit=`
- `GET /projects/{id}/card-sync`、`POST .../card-sync/export`、`POST .../card-sync/import`

**5.2c · 数据库表**（`contracts/db.v1.sql`，17 张）：`schema_meta`、`projects`、`project_configs`、`requirements`、`acceptance_criteria`、`tasks`、`task_deps`、`task_scope`、`task_verify`、`task_acceptance`、`runs`、`run_stages`、`run_changes`、`evidence`、`agent_profiles`、`events`、`card_sync`。

### 5.3 `client/`（pnpm workspace）

| 包/目录 | 关键导出 | 职责/要点 |
| --- | --- | --- |
| `apps/web` | `App.jsx`（default export）、`main.jsx`（挂载入口） | 单页应用，`view` 为组件内 state（无 URL 深链）；4 个视图 |
| `apps/web/src/views/FlowView.jsx` | `FlowView` | 流程视图：SVG 连线 + 绝对定位节点，`data-testid=task-node/req-node` |
| `apps/web/src/views/CardView.jsx` | `CardView` | 卡详情：编辑表单 + 最近执行 + 证据链 + 执行历史 |
| `apps/web/src/views/EvidenceView.jsx` | `EvidenceView` | 证据原文 + sha256 |
| `apps/web/src/views/SyncView.jsx` | `SyncView` | 卡同步三方比较状态表 |
| `packages/api-client` | `api`, `getToken`, `setToken`, `DEFAULT_TOKEN` | 唯一 API 出口；token 存 localStorage `devloop.token` |
| `packages/ui` | `cn`, `Button`, `buttonVariants`, `Input`, `Textarea`, `Label`, `Badge`, `StatusBadge`, `Card/CardHeader/CardTitle/CardContent`, `Table/*`, `FloatingInput/FloatingTextarea/FloatingSelect` | shadcn 风格；`StatusBadge` 按 `TONE_BY_STATUS` 映射状态颜色 |
| `packages/shell` | `pickAdapter`, `CAPABILITIES`, `assertCapable`, `unsupportedAdapter`, `unsupportedCapability` | 三类能力 `fs/term/agent`；browser 全降级、tauri 走 IPC |

### 5.4 `contracts/` 与 `config/`

- **契约是唯一事实来源**：`server/db.mjs` 直接执行 `db.v1.sql` 做迁移；`api.mjs` 下发 `schemaUrl`；`shell/tauri.mjs` 命令名对应 `ipc.v1.md`。破坏性变更开 `v2`。
- **双写边界**（`contracts/README.md`）：配置=仅服务端（源头 Git 的 project.yaml）；agent 配置=仅服务端；卡=客户端（乐观锁）；运行/证据=仅服务端。
- **配置覆盖链**：`platform.defaults → presets.<stack> → project.yaml → CLI --set`。
- **provider 三种 kind**：`openai-compatible` / `anthropic` / `cli`（`local-agent` 走 `node tools/local-agent.mjs`）；密钥只写 `api_key_env` 环境变量名。
- **三个栈预设**：`go-stdlib`（go build/vet/test）、`node-esm`（pipeline 工具 gate）、`node-plain`（node --check / test）。

---

## 6. 入口点与常用命令

```bash
# 依赖安装
npm --prefix server ci          # 后端依赖（只有 pg）
pnpm --dir client install --frozen-lockfile   # 前端（pnpm workspace）

# 数据库（本地/容器）
docker compose up -d postgres   # 127.0.0.1:55432，DATABASE_URL=...@127.0.0.1:55432/devloop

# 初始化示例仓库 + 启动服务端
node scripts/bootstrap.mjs
node server/index.mjs           # http://127.0.0.1:8787，token dev-local-token

# 前端
cd client && pnpm dev           # Vite :5173，/api 代理到 8787
cd client && pnpm build         # 产物 → apps/web/dist，服务端直接托管

# CLI（内核侧）
node platform/cli.mjs projects
node platform/cli.mjs doctor    --project ledger-cli
node platform/cli.mjs plan      --project ledger-cli
node platform/cli.mjs run       --project ledger-cli --task T-104
node platform/cli.mjs agents    --project ledger-cli --role implementer

# 测试与验证
node server/test/api.test.mjs
npm run verify                  # = bootstrap && api/cardsync/ci-contract 三个测试
node tools/visual/check.mjs     # 视觉验收（playwright-core + 系统 Chrome，需服务端已起）
node tools/visual/capture-docs.mjs  # 重生成 docs/images/ 四张界面插图
```

---

## 7. 环境变量

| 变量 | 作用 |
| --- | --- |
| `DATABASE_URL` | PG 连接串（默认 `postgres://devloop:devloop@127.0.0.1:5432/devloop`） |
| `DEVLOOP_PORT` / `DEVLOOP_HOST` / `DEVLOOP_TOKEN` | 服务端端口/监听/访问令牌（默认 8787 / 127.0.0.1 / dev-local-token） |
| `PG_PORT` / `PROD_PORT` / `DEVLOOP_PORT` | compose 映射端口（55432 / 8788 / 8787） |
| `DSH_PLATFORM_ALLOW_NETWORK=1` | 放行 `ai.invoke()` 真实模型调用（默认禁网） |
| `DSH_PROMPT_FILE` | cli 形态 agent 的 prompt JSON 文件路径 |
| `DSH_AGENT_ROLE` / `DSH_AGENT_NAME` | cli 形态 agent 子进程环境 |
| `VISUAL_URL` | `tools/visual/*` 的服务端地址（`check.mjs`/`debug.mjs` 默认 8792；`capture-docs.mjs` 默认 8787） |

---

## 8. 约定与坑（AI 工具务必注意）

1. **契约先行，禁止单侧设计接口**：改 API/DB/配置形状先改 `contracts/`，两边都从它派生。
2. **不硬编码项目名/模型名/技术栈名进内核**：接新仓/新模型/新栈只写配置（README 的 5 步）。
3. **判据先行 + 缺陷回归**：验收测试先红；发现缺陷先写复现测试再最小修复（见 `docs/backlog.md` 流程约定）。
4. **判据（测试文件）永久禁改**：`deny_write` 默认含 `**/*_test.go`、`**/*.test.mjs`、`**/*.spec.mjs`、`pipeline/**`。
5. **`cli.mjs` 顶层即执行**：import 它会触发命令 dispatch，勿当库 import。
6. **沙箱禁管道**：所有子进程 `shell:true` + stdio 文件重定向（管道会 EPERM），这同时让每次门禁留下日志证据。
7. **事务仅用于卡更新**：`store.mjs` 只有 `updateRequirement`/`updateTask` 用 `withTransaction`，其余单条 SQL（幂等靠 upsert/`ON CONFLICT`）。
8. **已知未闭合项**：`checkBudget` 未真正校验 `max_diff_lines`（只校验文件数）；路由是组件内 state 无深链；`worktreePath` 与 `prepareWorktree` 取平台根路径的字段不一致（`platform_root` vs `vars['platform.root']`）——改这里时先确认。
9. **README 口径差异**（以源码为准）：端点 18 条（README 写 19）、表 17 张（README 写 16）、`docker/Dockerfile` 三段构建（README 写两段）。
10. **前端状态无缓存**：面板一切状态由服务端算好返回，客户端只渲染；卡写带 `If-Match`。

---

## 9. 深读指引

| 主题 | 文档 |
| --- | --- |
| 总体/命令/结构 | `README.md` |
| 接新仓库（5 步） | `docs/01-接入新仓库.md` |
| AI 接入 | `docs/02-AI-接入.md` |
| 平台治理/证据/指标 | `docs/03-平台治理.md` |
| 客户端/服务端架构 | `docs/04-客户端服务端架构.md` |
| 卡同步与冲突检测 | `docs/05-卡同步与冲突检测.md` |
| 容器化开发 | `docs/06-容器化开发.md` |
| 待办/已知问题/回归约定 | `docs/backlog.md` |
| 契约包总纲/双写边界 | `contracts/README.md` |
| 单仓零迁移样例 | `samples/order-cancel-pilot/README.md` |
