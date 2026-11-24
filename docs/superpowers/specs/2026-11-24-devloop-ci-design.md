# devloop-core CI 设计

日期：2026-11-24
状态：已批准（方案 B）

## 意图

仓库已经推到 GitHub，但没有任何 CI。现在只有在本地 clone 并手动跑过测试的人才知道契约是否成立；
接手的人、或未来改完东西的人，没有任何自动信号。

目标不是"加个徽章"，而是**让 CI 跑的命令和本地跑的完全同一条**，避免出现"CI 绿、本地红"。

## 目标

- push 到 `main` 与开 PR 时，在干净环境跑通全部契约测试（API 9 项 + 卡同步 8 项）。
- CI 与本地共用一个入口：`npm run verify`。
- workflow 保持在 20 行量级，不引入 npm 依赖，不使用第三方 action（除官方 checkout/setup-node）。

## 非目标

- 不做发布、打包、容器镜像。
- 不做多 Node 版本矩阵。
- 不跑示例仓（Go / Node）的业务门禁——那属于被接入仓库自己的 CI。

## 反目标（即使技术上能跑也算失败）

- CI 跑的命令与本地不一条 → 信号不可信。
- 需要人工 bootstrap 或"在我机器上能跑"才能绿 → 说明装配没进版本库。
- 为一个只有一条运行时路径的仓库上矩阵 → 首绿时间翻倍，无收益。

## 约束

| 约束 | 依据 |
| --- | --- |
| Node 固定 24 | `server/db.mjs` 用 `node:sqlite` 的 `DatabaseSync`，下限 22.5；当前 LTS 是 24 |
| 必须先 bootstrap | 测试依赖 `repos/` 下的 git 仓库，由 `scripts/bootstrap.mjs` 从 `samples/` 生成 |
| 不需要 `npm ci` | 仓库零 npm 依赖，也没有 lockfile |
| git 身份由脚本自己设置 | `bootstrap.mjs` 在每个示例仓里写 repo 级 `user.email` / `user.name`，因此 runner 无需全局配置 |

## 方案

| 方案 | 内容 | 取舍 |
| --- | --- | --- |
| A | 单 job 把命令写死在 workflow 里 | 改动最小，但本地与 CI 各记一套命令，容易漂移 |
| **B（采用）** | 加 `package.json`（bootstrap / test / verify），workflow 调 `npm run verify` | 多一个 10 行文件，换来单一入口，后续加 lint 有落脚点 |
| C | Node 22 / 24 矩阵 | 仓库只有一条运行时路径，矩阵只增加时间，无信息增益 |

选 B。

## 怎么做（已定部分）

- `package.json`：`private: true`、`engines.node >= 24`、三个 script：
  - `bootstrap` → `node scripts/bootstrap.mjs`
  - `test` → 顺序跑 `server/test/api.test.mjs`、`server/test/cardsync.test.mjs`
  - `verify` → `bootstrap` + `test`
- `.github/workflows/ci.yml`：触发 `push`（main）+ `pull_request`；`ubuntu-latest`；
  `actions/checkout@v4` + `actions/setup-node@v4`（Node 24）；步骤顺序 bootstrap → 测试。
- **判据先行**：新增 `server/test/ci-contract.test.mjs`，断言 workflow 与 package.json 的契约
  （Node 版本、必须先 bootstrap、两个测试文件都被执行）。先红，再实现，再绿。

## 留给构建者的判断

- workflow 里 step 的命名与拆分粒度。
- 是否额外加 `.nvmrc`：倾向不加，`engines` + `setup-node` 已表达同一个事实，两份来源反而会漂移。
- 失败时是否上传日志：暂不做，等真有 flaky 再说。
