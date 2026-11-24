# 订单取消 · 自动化开发切片（Pilot）

一个**单仓 + 前后端 + 契约包**的最小仓库，用一条真实需求（订单取消）跑通
「需求卡 → 任务卡 DAG → 隔离实现 → 三段验证 → 串行合并 → 需求级集成门禁」的完整闭环。

目的不是演示"AI 会写代码"，而是把**判据、写域、证据**做成可机械执行的约束：
机器只认命令退出码和 git diff，不认"我觉得做完了"。

## 实测结果（本仓库，零依赖，可重复执行）

| 环节 | 结果 |
| --- | --- |
| 分解校验 `plan.mjs` | 4 张任务卡 → 3 层 DAG，0 错误 0 警告 |
| 基线（实现为桩） | 全量测试 **23 红** —— 验收测试先落主干 |
| T-0121 契约 | 首轮因"改了测试文件"被写域门禁拦截 → 撤回后 PASS 合入 |
| T-0122 领域逻辑 | 首轮 PASS 合入 |
| T-0123 前端状态机 | 首轮 PASS 合入 |
| T-0124 接入 + 集成门禁 | 全量 23/23 PASS 后合入 |
| 最终 main | build 5 模块 / lint 0 问题 / test 23 pass 0 fail |

证据全部落在 `pipeline/.runs/<任务>/attempt-<n>/`（`result.json`、`verify` 日志、`diff.patch`），
汇总账本 `pipeline/.runs/ledger.jsonl`。

## 目录

```
apps/api/src/orders/        取消订单领域逻辑（store.mjs / cancel.mjs）
apps/api/src/http/          HTTP 接入（routes.mjs）
apps/web/src/               前端取消按钮状态机
packages/contracts/src/     前后端共用契约（原因枚举 / 错误码 / 校验）
pipeline/spec/              需求卡
pipeline/tasks/             任务卡 + 生成的 _graph.json
pipeline/tools/plan.mjs     分解产物校验（DAG / 写域 / 判据存在性）
pipeline/tools/run.mjs      单任务执行器（worktree 隔离 → 越界检查 → 验证 → 合并）
pipeline/tools/gates/       build / lint / test 三段门禁
pipeline/docs/              拆解逻辑、卡规范、落地路径
```

## 三条命令

```bash
node pipeline/tools/plan.mjs                 # 校验需求卡 + 任务卡，输出 DAG
node pipeline/tools/run.mjs T-0122 --prepare # 准备隔离工作区，交给实现者（人或 agent）
node pipeline/tools/run.mjs T-0122           # 越界检查 → 三段验证 → 合并 → main 复验
node pipeline/tools/run.mjs --all            # 按 DAG 顺序跑完全部任务
```

`verify` 三段默认是：

```bash
node pipeline/tools/gates/smoke.mjs   # 等价于你们的 build
node pipeline/tools/gates/lint.mjs    # 等价于你们的 lint
node pipeline/tools/gates/tests.mjs   # 等价于你们的 test（可传目录过滤）
```

## 接到你们仓库，只需要改 5 个地方

| # | 改什么 | 例子 |
| --- | --- | --- |
| 1 | 三段 verify 命令 | `pnpm -w build` / `pnpm -w lint` / `pnpm vitest run <dir>` |
| 2 | 卡里的 `scope.write` 改成本仓库真实目录 | `services/order/**`、`web/src/pages/order/**` |
| 3 | 卡里的 `acceptance` 引用需求卡的验收标准 id | 保持现状即可 |
| 4 | 需求卡的 `policy.deny_write`（禁止改测试/流水线） | 保持现状即可 |
| 5 | `run.mjs` 的分支与合并策略 | 改 `feature/REQ-xxx` 集成分支 + merge queue |

**刻意没做的部分**（避免误以为已经全自动）：

- 卡里的 `objective` 是**人（或 agent）写的**，`plan.mjs` 只校验不生成。自然语言 → DAG 的分解由 LLM 承担，
  prompt 约定见 `pipeline/docs/02-卡规范.md`。
- 没有接任何 LLM 调用。本仓库只提供**判据与执行**，实现由外部 agent 在 worktree 里完成。
  这样做的好处：换模型、换 agent 框架都不影响流水线。
- 没有 UI、没有真实数据库。库存用内存实现，是为了让"重复取消不能重复释放"这条最容易被写错的规则可被断言。
