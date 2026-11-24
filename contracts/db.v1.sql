-- devloop 存储模型 v1（SQLite）
-- 约定：
--   1) 时间一律 ISO-8601 UTC 字符串；id 一律文本（业务 id 可读，代理键用 hex）。
--   2) 所有派生状态（任务状态、DAG 层级、需求完成度）由服务端计算后落库，客户端不重算。
--   3) 证据只存元数据与 sha256，内容存文件系统（evidence.rel_path 相对 data 根）。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 被接入的仓库
CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  stack          TEXT NOT NULL,
  repo_path      TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  cards_mode     TEXT NOT NULL DEFAULT 'platform' CHECK (cards_mode IN ('platform', 'repo')),
  status         TEXT NOT NULL DEFAULT 'active'   CHECK (status IN ('active', 'paused')),
  schema_version TEXT NOT NULL DEFAULT 'project/v1',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- 每次配置变更留存完整快照（审计与回滚；客户端只读）
CREATE TABLE IF NOT EXISTS project_configs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  resolved_json TEXT NOT NULL,          -- 合并后的最终配置
  sources_json  TEXT NOT NULL,          -- 每个叶子值的来源（platform|preset:x|project）
  sha256        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS requirements (
  id         TEXT PRIMARY KEY,          -- REQ-100
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'accepted', 'archived')),
  autonomy   TEXT NOT NULL CHECK (autonomy IN ('auto', 'assisted', 'human-only')),
  owner      TEXT,
  summary    TEXT,
  version    INTEGER NOT NULL DEFAULT 1, -- 乐观锁
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id, status);

CREATE TABLE IF NOT EXISTS acceptance_criteria (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  id             TEXT NOT NULL,          -- AC-1
  seq            INTEGER NOT NULL,
  text           TEXT NOT NULL,
  verify_by      TEXT NOT NULL,
  PRIMARY KEY (requirement_id, id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,       -- T-101
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  objective      TEXT,
  autonomy       TEXT NOT NULL CHECK (autonomy IN ('auto', 'assisted', 'human-only')),
  status         TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'running', 'passed', 'failed', 'blocked')),
  dag_layer      INTEGER,                -- 服务端计算的拓扑层级（null = 尚未计算）
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_requirement ON tasks(requirement_id, status);

CREATE TABLE IF NOT EXISTS task_deps (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
);

CREATE TABLE IF NOT EXISTS task_scope (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('write', 'read', 'deny')),
  pattern TEXT NOT NULL,
  PRIMARY KEY (task_id, kind, pattern)
);

CREATE TABLE IF NOT EXISTS task_verify (
  task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  ref              TEXT NOT NULL,        -- 门禁名（build/lint/test）或裸命令
  resolved_command TEXT,                 -- 服务端解析后的实际命令
  PRIMARY KEY (task_id, seq)
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ac_id   TEXT NOT NULL,
  PRIMARY KEY (task_id, ac_id)
);

-- 一次执行（重试即新 attempt）
CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt        INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'cancelled')),
  reason         TEXT,
  actor          TEXT,                   -- 触发者（用户/系统/agent）
  agent_profile  TEXT,
  workspace      TEXT,
  changed_files  INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (task_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_stages (
  run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  name         TEXT NOT NULL,
  command      TEXT NOT NULL,
  exit_code    INTEGER,
  duration_ms  INTEGER,
  log_evidence TEXT REFERENCES evidence(id) ON DELETE SET NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS run_changes (
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,
  in_scope INTEGER NOT NULL CHECK (in_scope IN (0, 1)),
  reason   TEXT,
  PRIMARY KEY (run_id, path)
);

CREATE TABLE IF NOT EXISTS evidence (
  id         TEXT PRIMARY KEY,
  run_id     TEXT REFERENCES runs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('diff', 'log', 'result', 'manifest', 'changes')),
  rel_path   TEXT NOT NULL,              -- 相对 data 根；内容在文件系统
  sha256     TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id, kind);

-- 服务端下发给客户端的 agent 配置（客户端只读）
CREATE TABLE IF NOT EXISTS agent_profiles (
  id             TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE, -- null = 平台默认
  role           TEXT NOT NULL CHECK (role IN ('decomposer', 'implementer', 'reviewer')),
  adapter        TEXT NOT NULL CHECK (adapter IN ('openai-compatible', 'anthropic', 'cli', 'vscode-claude-code')),
  model          TEXT,
  command        TEXT,
  env_json       TEXT,
  policy_json    TEXT,
  schema_version TEXT NOT NULL DEFAULT 'agent/v1',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_project ON agent_profiles(project_id, role);

-- 事件流：面板时间线与客户端增量拉取（since=event id）
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     TEXT,
  requirement_id TEXT,
  task_id        TEXT,
  run_id         TEXT,
  kind           TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, id);
