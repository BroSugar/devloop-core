# PRD 审核把关设计

日期：2026-11-25
状态：已批准

## 意图

产品产出的 PRD 文档，上传云平台前缺一道质量把关。本功能在 devloop-core 里加一条「完善 → 审核」的门：产品上传 PRD，先由「完善 agent」补齐结构/口径/边界/异常路径，再由「独立审核 agent」按标准文档检查清单出 verdict；审核通过才进入「可上传」状态。v1 不做真实上传，做到「审核通过」为止，上传留成适配器接口。

## 目标

1. PRD 作为独立实体（不并入需求卡），有自己的生命周期：`draft → refining → reviewing → approved / needs_revision / rejected`。
2. 一次「完善」：`refiner` agent 按检查清单补齐缺口，输出 refined 文档。
3. 一次「审核」：`prd-reviewer` agent 按检查清单出 `verdict (pass/needs_revision/reject) + findings[]`；`needs_revision` 退回继续完善。
4. 审核记录进证据链：每次完善/审核的记录（agent 输出 + verdict + findings）以 sha256 落库，可追溯。
5. 上传留适配器接口：定义 `publish` 契约，v1 只把状态推到 `approved`（可上传），不接真实平台。
6. 前端新增 PRD 视图：列表 / 上传 / 查看内容 / 触发完善与审核 / 查看审核结果。

## 非目标

- v1 不接真实云平台上传（只留接口）。
- 不做 PRD → 需求卡（`REQ-*`）的分解（后续功能）。
- 不做多人协作/评论/历史 diff 预览（v1 单版本文档 + 乐观锁即可）。
- 不引入新的 AI provider（复用现有 `providers.yaml` 的 openai-compatible / anthropic / cli）。

## 反目标

- 「完善」和「审核」用同一个 agent（自审）→ 等于没把关，违背「独立审核 agent」的决定。
- 审核结果不可追溯（没有 sha256/记录链）→ 违背平台「证据可追溯」。
- 把 PRD 塞进需求卡（`REQ-*`），让文档评审和开发判据互相污染。
- 上传做成 v1 强依赖，阻塞审核通过后的流程。

## 约束

| 约束 | 依据 |
| --- | --- |
| 服务端 Node + PostgreSQL，契约在 `contracts/` | 平台现状 |
| 前端 React 19 + Vite + Tailwind v4 + pnpm workspace | 平台现状 |
| AI 调用默认禁网（`DSH_PLATFORM_ALLOW_NETWORK=1` 才放行） | `platform/lib/ai.mjs` |
| 检查清单 = v2（11 硬门 + 4 软门，见下） | 已与需求方确认 |
| 乐观锁 `ETag` + `If-Match` | `contracts/README.md` 约定 |

## 方案（已定）

| 决策 | 选择 |
| --- | --- |
| 口径 | C：检查清单（硬门）+ 质量评审（软门） |
| 审核主体 | 独立 `prd-reviewer` agent（与 `refiner` 分离） |
| PRD 与需求卡 | A：独立实体，不并入 `REQ-*` |
| 云平台上传 | v1 不接，做到 `approved` 为止，留 `publish` 适配器契约 |
| 证据链 | 完善/审核记录 sha256 落库，可追溯 |

## 数据模型（新增两张表，进 `contracts/db.v1.sql`）

- `prds`：`id`（`PRD-*`）、`project_id`、`title`、`content`（正文纯文本）、`status`（`draft/refining/reviewing/approved/needs_revision/rejected`）、`version`（乐观锁）、`created_at/updated_at`。
- `prd_reviews`：`id`、`prd_id`、`kind`（`refine`/`review`）、`status`（`running/passed/failed`）、`verdict`（`pass/needs_revision/reject`，refine 无）、`findings`（JSONB）、`output`（agent 输出文本）、`agent`（角色名）、`sha256`（output 哈希）、`content_sha256`（**本次评审/完善所读入的 `prds.content` 哈希，钉住输入**）、`content_version`（读入时的 `prds.version`）、`created_at`。

> 归属：PRD 挂在 `project_id` 下（平台是项目中心的，agent/证据/配置都按项目）——**已定**。

## 审核流程（状态机）

```
draft
  → 上传/编辑后 → refining（触发完善）
refining → refiner agent 补齐 → refined 文档回写为 content 新版本 → reviewing
reviewing → prd-reviewer agent 按检查清单 → verdict:
    pass → approved（可上传，v1 终态）
    needs_revision → needs_revision（退回，附 findings）
    reject → rejected（终态，判定为不可用，需人工）
needs_revision → 再次 refine（或人工编辑）→ reviewing
approved →（v1 到此为止；未来走 publish 适配器）
```

- 每次「完善」和「审核」都落一条 `prd_reviews`（含 `sha256(output)` + `content_sha256`/`content_version` 钉住输入，可重放审计）。
- 审核 verdict/findings 复用平台 reviewer 契约；但 PRD findings 的定位字段用 `item`（检查清单第几项）替代代码评审的 `file/line`。
- **循环上限**：refine→review 最多 **3 轮**；第 3 轮仍 `needs_revision` 则置 `needs_revision` 并需人工介入（不再自动循环），防成本失控（对齐现有 agent policy 的 `maxRepairs` 精神）。
- **失败回退**：agent 调用失败/超时（`prd_reviews.status = failed`）时，`prds.status` 回退到触发前状态，允许重试；失败记录保留。
- **评审期间的并发**：`refining`/`reviewing` 期间 PRD 视为锁定，人工编辑返回 409（乐观锁已覆盖）。

## 检查清单（v2，已确认）

硬门 11 项（1–11）+ 软门 4 项（12–15）。**逐字定义如下（写进 `config/prd-checklist.yaml`，构建者不得改写）**：

| # | 门 | 检查项 |
| --- | --- | --- |
| 1 | 硬 | 问题陈述：一句话说清要解决什么问题、为什么现在做 |
| 2 | 硬 | 目标用户/角色：谁在用、谁受益，明确到角色 |
| 3 | 硬 | 目标可衡量：有明确成功标准，禁止"提升体验""优化效率"这类不可判定的话 |
| 4 | 硬 | 非目标/反目标：明确不做什么 |
| 5 | 硬 | 范围明确：in-scope / out-of-scope 写清楚，涉及哪些系统/模块 |
| 6 | 硬 | 口径定义：关键术语有定义（无黑话、无未定义的缩写） |
| 7 | 硬 | 核心功能列表完整：覆盖问题陈述里的全部诉求，无遗漏 |
| 8 | 硬 | 优先级明确：每个功能标 P0/P1/P2 |
| 9 | 硬 | 每个核心功能都有验收标准：说清「怎么算做完」 |
| 10 | 硬 | 验收可判定：可测试/可验证，不是"体验良好""性能更好"这类模糊描述 |
| 11 | 硬 | 数据指标明确：关键指标有口径，需要埋点/上报的数据点明确 |
| 12 | 软 | 失败/异常场景覆盖：错误输入、空态、超时、并发、权限、网络失败 |
| 13 | 软 | 边界条件覆盖：上下限、极端值、边界值 |
| 14 | 软 | 无自相矛盾：目标 ↔ 功能 ↔ 验收三者一致 |
| 15 | 软 | 无残留占位：无 TODO/待定/未定义引用 |

- **硬门**：缺任何一项 → `needs_revision`（列出缺失项）。
- **软门**：由 reviewer agent 判定；问题轻微可 `pass` 附 findings，实质缺陷则 `needs_revision`。

## 角色与配置

- 新增角色 `refiner`：prompt `config/prompts/refine.md`（补齐结构/口径/边界/异常路径）。
- 新增角色 `prd-reviewer`：prompt `config/prompts/prd-review.md`（按检查清单出 verdict + findings）。
- 两者在 `config/agents.yaml` 注册，走现有 `providers.yaml`；路由默认 + 项目级覆盖同现有机制。
- **执行模型（澄清）**：服务端直接 `import` 内核的 `platform/lib/ai.mjs` 调 `loadAi/resolveAgent/buildRequest/invoke`（server 已 import `platform/lib` 的 yaml/runtime/policy，边界一致）；**同步执行**（阻塞 HTTP 请求，与现有 `executeRun` 一致）。异步队列/SSE 属 v1.1，不在本次。沙箱内默认 dry-run（`DSH_PLATFORM_ALLOW_NETWORK=1` 才真发 http provider；`cli` 形态本地 agent 不受网络开关限制）。

## 上传适配器接口（v1 只定义不实现）

- 契约：`publish(prd) -> { ok, externalId?, error? }`；幂等键建议 `prd.id + prd.version`。
- v1：`approved` 是终态（UI 显示「可上传」），不调用任何外部系统。
- 未来接入：新增 `server/publish/*.mjs` 适配器 + 重试/失败回退/版本留痕（`prd.version` 作留痕键）。

## 证据链

- `prd_reviews` 每条 `output` + `findings` + `verdict` 作为证据，`sha256(output)` 落库可校验。
- 与现有 `archive/evidence` 的关系：v1 以内联 `prd_reviews` 为准；是否额外写 `evidence` 文件由构建者定（倾向 v1 不额外写文件，靠 sha256 追溯）。

## 前端

- 头部新增「PRD」视图按钮（与「流程视图」「卡同步」并列）。
- PRD 视图：列表（状态徽章）+ 新建/上传（粘贴正文）+ 详情（读正文 + 触发「完善」「审核」+ 查看 findings）。
- 状态徽章复用 `StatusBadge` 的 tone 映射（`draft/refining/reviewing/needs_revision/approved/rejected` 需补充映射）。

## 留给构建者的判断

- `prds` 是否加 `owner/author`、附件（二进制）字段——v1 倾向只存纯文本正文。
- `prd_reviews.findings` 的 JSON 结构细节（id/item/severity/problem/requiredFix，`item` 指检查清单第几项）。
- 检查清单写进 `config/prd-checklist.yaml`（已定）；其 YAML 结构由构建者定。
- 前端 PRD 视图的具体布局与交互。
- `publish` 契约最终函数签名（v1 仅定义，不落地）。
