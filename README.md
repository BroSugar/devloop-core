# devplatform：配置驱动的自动化开发平台

把「需求卡 → 任务卡 DAG → 隔离实现 → 统一门禁 → 证据归档」做成**与仓库无关的内核**，
仓库差异、技术栈差异、AI 供应商差异**全部走配置**。

单仓试点在 [`../order-cancel-pilot`](../order-cancel-pilot/README.md)；本目录是它的平台化形态。

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
