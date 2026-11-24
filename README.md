# devloop-core

配置驱动的自动化开发平台：把「需求卡 → 任务卡 DAG → 隔离实现 → 统一门禁 → 证据归档」做成与仓库无关的内核，
仓库差异、技术栈差异、AI 供应商差异**全部走配置**。服务端负责 API、存储与执行；客户端（Web / 桌面）只做卡编辑与证据查看。

## 快速开始

```bash
node scripts/bootstrap.mjs      # 1. 把 samples/ 里的示例仓复制成独立 git 仓库（首次）
node server/index.mjs           # 2. 启动：http://127.0.0.1:8787 （token: dev-local-token）
node server/test/api.test.mjs   # 3. API 契约测试
```

打开 <http://127.0.0.1:8787/> 就是面板。平台自己不内嵌被管仓库：`repos/` 由 bootstrap 从 `samples/` 生成并 gitignore。

单仓试点见 [`samples/order-cancel-pilot`](samples/order-cancel-pilot/README.md)：它是最早跑通的一条需求，现作为「零迁移接入既有仓库」的样例。

## 结构

```
platform/           内核（不含任何项目名、模型名、技术栈名）
  cli.mjs           统一入口
  lib/config.mjs    分层配置解析 + 覆盖来源追踪
  lib/plan.mjs      分解产物校验（DAG / 写域 / 判据）
  lib/runtime.mjs   子进程 + git worktree + 门禁解析与执行
  lib/policy.mjs    写域 / 预算 / 禁改
  lib/evidence.mjs  证据归档 + sha256 manifest + 校验
  lib/ai.mjs        provider / agent 适配（openai-compatible / anthropic / cli）
  lib/template.mjs  卡模板渲染
config/
  platform.yaml     全局默认（安全默认：禁改测试文件）
  presets/          技术栈预设：node-esm、go-stdlib
  providers.yaml    AI 供应商注册表
  agents.yaml       角色 → provider 路由
  templates/        feature / bugfix 卡模板
  prompts/          decomposer / implementer / reviewer 提示词
projects/
  order-cancel/     项目 1：既有单仓，cards 留在仓库内（零迁移接入）
  ledger-cli/       项目 2：全新 Go 仓库，cards 在平台侧
repos/              被管仓库的外部 checkout（不内嵌）
archive/            证据包（manifest + index.jsonl）
```

## 命令

```bash
node platform/cli.mjs projects
node platform/cli.mjs doctor   --project all
node platform/cli.mjs plan     --project ledger-cli
node platform/cli.mjs new-task --project ledger-cli --template feature --id T-104 ...
node platform/cli.mjs prepare  --project ledger-cli --task T-104
node platform/cli.mjs run      --project ledger-cli --task T-104 [--no-merge]
node platform/cli.mjs run      --project ledger-cli --all
node platform/cli.mjs agents   --project ledger-cli --role implementer   # dry-run 请求
node platform/cli.mjs archive-index | archive-verify
```

## 两个项目只能靠配置区分

| | order-cancel | ledger-cli |
| --- | --- | --- |
| 技术栈 | Node ESM | Go 标准库 |
| 门禁 | `node .../smoke|lint|tests` | `go build / go vet / go test` |
| 卡位置 | 仓库内（`cards.mode: repo`） | 平台侧（`cards.mode: platform`） |
| AI 路由 | 默认 | 实现者走本地 agent |
| 差异总行数 | **17 行 YAML** | **24 行 YAML** |

内核代码零改动。这就是"接新仓新项目不用改代码"的字面含义。

## 实测（本次执行）

| 执行 | 结果 | 原因 |
| --- | --- | --- |
| T-101 attempt-1 | FAIL | 引擎缺陷：门禁在错误目录执行（已修） |
| T-101 attempt-2 | PASS | 合入 main |
| T-102 attempt-1 | PASS | 合入 main |
| T-103 attempt-1/2 | FAIL | 仓库配置缺陷：`.gitignore` 里的 `ledger` 误伤 `cmd/ledger/` |
| T-103 attempt-3 | PASS | 全量 `go test ./...` 绿后合入 |

6 次执行 / 6 份证据包 / 哈希校验全部一致。**3 次失败没有一次是"模型写得不对"**：
两次是工作区与 git 语义（门禁 cwd、gitignore 误伤），一次被平台按预期拦住。
平台化的前两周，成本几乎都在这里，而不是在模型能力上。

## 接一个新仓库（5 步，零代码）

1. `projects/<id>/project.yaml`：`repo.path`、`branch`、`stack`、`cards.mode`。
2. 栈不存在就加 `config/presets/<stack>.yaml`（三条门禁命令 + 必要 env）。
3. 把验收测试写进仓库并跑红（判据先行）。
4. 需求卡 + 任务卡（可 `new-task` 从模板生成），`scope.write` 落到真实文件。
5. `doctor` → `plan` → 逐卡 `prepare`/`run`。

详见 [docs/01-接入新仓库.md](docs/01-接入新仓库.md)。

## 边界（明确没做）

- **不内建模型调用**：`invoke()` 有 http 实现，但默认禁用网络（`DSH_PLATFORM_ALLOW_NETWORK=1` 才放行）。
  本沙箱无外网，所以 AI 部分验证到"请求构造 + 路由 + dry-run"为止。
- **不做需求澄清**：分解器的输入仍是人写的需求卡。
- **单实例本地部署**：并发调度、队列、多租户配额未实现（见 [docs/03-平台治理.md](docs/03-平台治理.md)）。

---

# 服务端 + 客户端（v1）

## 启动

```bash
node server/index.mjs          # http://127.0.0.1:8787  （token 默认 dev-local-token）
node server/test/api.test.mjs  # API 契约测试（9 项）
```

打开 <http://127.0.0.1:8787/> 是面板；`/api/v1/*` 是需要 Bearer token 的接口。

## 契约先行

`contracts/` 是服务端与客户端的唯一事实来源，两边都从它派生：

| 文件 | 作用 |
| --- | --- |
| [api.v1.yaml](contracts/api.v1.yaml) | 19 个端点、信封、错误码、ETag |
| [db.v1.sql](contracts/db.v1.sql) | 16 张表：项目/配置快照/需求/AC/任务/依赖/写域/门禁/执行/阶段/变更/证据/agent/事件 |
| [config.schema.v1.json](contracts/config.schema.v1.json) | 项目配置形状（服务端校验，客户端只读） |
| [agent.schema.v1.json](contracts/agent.schema.v1.json) | agent 配置 + 执行策略（服务端下发） |
| [ipc.v1.md](contracts/ipc.v1.md) | 壳 ↔ 视图：fs / term / agent 三类能力 |

## 三层客户端

```
client/views/   纯渲染：只认 adapter + api，不碰 window/fetch
client/shell/   适配器：adapter.mjs（契约+能力协商）、browser.mjs（全降级）、tauri.mjs（IPC）
client/web/     壳 A：单页 Web（index.html + main.mjs + api.mjs + 样式）
```

Web 形态没有 fs/term/agent，视图据此隐藏本地入口；Tauri 壳接上后同一份视图获得全部能力。
桌面壳决策见 [docs/04-客户端服务端架构.md](docs/04-客户端服务端架构.md)：**Tauri v2**，三周内交付不了 PTY 就切 Electron。

## 状态归属

- 面板的节点坐标、任务状态、DAG 层级、统计，全部由服务端算好返回（`GET /projects/{id}/panel`、`/requirements/{id}/dag`）。
- 客户端只对**卡**有写权限，必须带 `If-Match: "v<version>"`；冲突返回 409。
- 配置与 agent 策略客户端只读；本地 agent 覆盖走 `localOverride` 上报，由服务端 policy 判定。

## 证据可追溯

每次执行产生：`changes.txt` / `diff.patch` / 每阶段 `verify` 日志 / `result.json`，每条都带 sha256。
`GET /runs/{id}/evidence` 列清单，`GET /evidence/{id}/content` 取原文，响应头 `x-evidence-sha256` 可与库中值比对。
