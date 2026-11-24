// 仓储层：所有 SQL 都收敛在这里，API 层不写 SQL。
// 原则：派生状态（任务状态、DAG 层级、统计）在这里算好写回，客户端只读不算。

import crypto from 'node:crypto';
import { now, transaction } from './db.mjs';

const J = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const P = (v) => (v === null || v === undefined ? null : JSON.parse(v));

export class Store {
  constructor(db) {
    this.db = db;
  }

  // ---------- projects ----------

  upsertProject(p) {
    const at = now();
    const existing = this.getProject(p.id);
    if (existing) {
      this.db.prepare(`UPDATE projects SET name=?, stack=?, repo_path=?, default_branch=?, cards_mode=?, updated_at=? WHERE id=?`)
        .run(p.name ?? existing.name, p.stack ?? existing.stack, p.repoPath ?? existing.repoPath,
          p.defaultBranch ?? existing.defaultBranch, p.cardsMode ?? existing.cardsMode, at, p.id);
      return this.getProject(p.id);
    }
    this.db.prepare(`INSERT INTO projects (id,name,stack,repo_path,default_branch,cards_mode,status,schema_version,created_at,updated_at)
                     VALUES (?,?,?,?,?,?, 'active', 'project/v1', ?, ?)`)
      .run(p.id, p.name ?? p.id, p.stack ?? 'custom', p.repoPath, p.defaultBranch ?? 'main', p.cardsMode ?? 'platform', at, at);
    return this.getProject(p.id);
  }

  mapProject(row) {
    if (!row) return null;
    return {
      id: row.id, name: row.name, stack: row.stack, repoPath: row.repo_path,
      defaultBranch: row.default_branch, cardsMode: row.cards_mode, status: row.status,
      schemaVersion: row.schema_version, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  getProject(id) {
    return this.mapProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  }

  listProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY id').all().map((r) => this.mapProject(r));
  }

  projectStats(projectId) {
    const tasks = this.db.prepare(`SELECT t.status AS status, COUNT(*) AS n FROM tasks t JOIN requirements r ON r.id = t.requirement_id
                                   WHERE r.project_id = ? GROUP BY t.status`).all(projectId);
    const requirements = this.db.prepare('SELECT COUNT(*) AS n FROM requirements WHERE project_id = ?').get(projectId).n;
    const by = Object.fromEntries(tasks.map((t) => [t.status, t.n]));
    return {
      requirements,
      tasks: tasks.reduce((a, t) => a + t.n, 0),
      passed: by.passed ?? 0,
      failed: by.failed ?? 0,
    };
  }

  // ---------- config snapshots ----------

  saveConfig(projectId, resolved, sources) {
    const json = JSON.stringify(resolved);
    const sha256 = crypto.createHash('sha256').update(json).digest('hex');
    const prev = this.latestConfig(projectId);
    if (prev && prev.sha256 === sha256) return prev;
    const version = (prev?.version ?? 0) + 1;
    this.db.prepare(`INSERT INTO project_configs (id,project_id,version,resolved_json,sources_json,sha256,created_at)
                     VALUES (?,?,?,?,?,?,?)`)
      .run(`cfg_${projectId}_${version}`, projectId, version, json, JSON.stringify(sources), sha256, now());
    return this.latestConfig(projectId);
  }

  latestConfig(projectId) {
    const row = this.db.prepare('SELECT * FROM project_configs WHERE project_id = ? ORDER BY version DESC LIMIT 1').get(projectId);
    if (!row) return null;
    return {
      projectId: row.project_id, version: row.version,
      resolved: P(row.resolved_json), sources: P(row.sources_json),
      sha256: row.sha256, createdAt: row.created_at,
    };
  }

  configGates(projectId) {
    const cfg = this.latestConfig(projectId);
    return cfg?.resolved?.gates ?? {};
  }

  // ---------- requirements ----------

  upsertRequirement(req) {
    const at = now();
    const existing = this.db.prepare('SELECT version FROM requirements WHERE id = ?').get(req.id);
    if (existing) {
      this.db.prepare(`UPDATE requirements SET project_id=?, title=?, status=?, autonomy=?, owner=?, summary=?, version=version+1, updated_at=? WHERE id=?`)
        .run(req.projectId, req.title, req.status, req.autonomy, req.owner ?? null, req.summary ?? null, at, req.id);
    } else {
      this.db.prepare(`INSERT INTO requirements (id,project_id,title,status,autonomy,owner,summary,version,created_at,updated_at)
                       VALUES (?,?,?,?,?,?,?,1,?,?)`)
        .run(req.id, req.projectId, req.title, req.status, req.autonomy, req.owner ?? null, req.summary ?? null, at, at);
    }
    this.db.prepare('DELETE FROM acceptance_criteria WHERE requirement_id = ?').run(req.id);
    (req.acceptance || []).forEach((ac, i) => {
      this.db.prepare('INSERT INTO acceptance_criteria (requirement_id,id,seq,text,verify_by) VALUES (?,?,?,?,?)')
        .run(req.id, ac.id, i, ac.text, ac.verifyBy);
    });
    return this.getRequirement(req.id);
  }

  getRequirement(id) {
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id);
    if (!row) return null;
    const acceptance = this.db.prepare('SELECT * FROM acceptance_criteria WHERE requirement_id = ? ORDER BY seq').all(id)
      .map((r) => ({ id: r.id, seq: r.seq, text: r.text, verifyBy: r.verify_by }));
    return {
      id: row.id, projectId: row.project_id, title: row.title, status: row.status,
      autonomy: row.autonomy, owner: row.owner, summary: row.summary, version: row.version,
      acceptance, createdAt: row.created_at, updatedAt: row.updated_at,
      stats: this.requirementStats(row.id),
    };
  }

  requirementStats(requirementId) {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM tasks WHERE requirement_id = ? GROUP BY status').all(requirementId);
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return { tasks: rows.reduce((a, r) => a + r.n, 0), passed: by.passed ?? 0, failed: by.failed ?? 0 };
  }

  listRequirements(projectId) {
    return this.db.prepare('SELECT id FROM requirements WHERE project_id = ? ORDER BY id').all(projectId)
      .map((r) => this.getRequirement(r.id));
  }

  updateRequirement(id, patch, guard) {
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id);
    if (!row) return { error: 'not_found' };
    if (guard !== undefined && row.version !== guard) return { error: 'conflict', current: this.getRequirement(id) };
    return transaction(this.db, () => ({
      data: this.upsertRequirement({
        id, projectId: row.project_id, title: patch.title, status: patch.status,
        autonomy: patch.autonomy, owner: patch.owner, summary: patch.summary,
        acceptance: patch.acceptance,
      }),
    }));
  }

  // ---------- tasks ----------

  upsertTask(task) {
    const at = now();
    const existing = this.db.prepare('SELECT version FROM tasks WHERE id = ?').get(task.id);
    if (existing) {
      this.db.prepare(`UPDATE tasks SET requirement_id=?, title=?, objective=?, autonomy=?, version=version+1, updated_at=? WHERE id=?`)
        .run(task.requirementId, task.title, task.objective ?? null, task.autonomy, at, task.id);
    } else {
      this.db.prepare(`INSERT INTO tasks (id,requirement_id,title,objective,autonomy,status,version,created_at,updated_at)
                       VALUES (?,?,?,?,?,'pending',1,?,?)`)
        .run(task.id, task.requirementId, task.title, task.objective ?? null, task.autonomy, at, at);
    }
    this.db.prepare('DELETE FROM task_deps WHERE task_id = ?').run(task.id);
    for (const dep of task.deps || []) {
      this.db.prepare('INSERT OR IGNORE INTO task_deps (task_id,depends_on) VALUES (?,?)').run(task.id, dep);
    }
    this.db.prepare('DELETE FROM task_scope WHERE task_id = ?').run(task.id);
    for (const kind of ['write', 'read', 'deny']) {
      for (const pattern of task.scope?.[kind] || []) {
        this.db.prepare('INSERT INTO task_scope (task_id,kind,pattern) VALUES (?,?,?)').run(task.id, kind, pattern);
      }
    }
    this.db.prepare('DELETE FROM task_verify WHERE task_id = ?').run(task.id);
    (task.verify || []).forEach((v, i) => {
      this.db.prepare('INSERT INTO task_verify (task_id,seq,ref,resolved_command) VALUES (?,?,?,?)')
        .run(task.id, i, typeof v === 'string' ? v : v.ref, typeof v === 'string' ? null : (v.resolvedCommand ?? null));
    });
    this.db.prepare('DELETE FROM task_acceptance WHERE task_id = ?').run(task.id);
    for (const ac of task.acceptance || []) {
      this.db.prepare('INSERT INTO task_acceptance (task_id,ac_id) VALUES (?,?)').run(task.id, ac);
    }
    return this.getTask(task.id);
  }

  getTask(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    const deps = this.db.prepare('SELECT depends_on FROM task_deps WHERE task_id = ? ORDER BY depends_on').all(id).map((r) => r.depends_on);
    const scope = { write: [], read: [], deny: [] };
    for (const r of this.db.prepare('SELECT kind,pattern FROM task_scope WHERE task_id = ?').all(id)) scope[r.kind].push(r.pattern);
    const verify = this.db.prepare('SELECT seq,ref,resolved_command FROM task_verify WHERE task_id = ? ORDER BY seq').all(id)
      .map((r) => ({ seq: r.seq, ref: r.ref, resolvedCommand: r.resolved_command }));
    const acceptance = this.db.prepare('SELECT ac_id FROM task_acceptance WHERE task_id = ? ORDER BY ac_id').all(id).map((r) => r.ac_id);
    const latest = this.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(id) || null;
    return {
      id: row.id, requirementId: row.requirement_id, title: row.title, objective: row.objective,
      autonomy: row.autonomy, status: row.status, dagLayer: row.dag_layer, version: row.version,
      deps, scope, verify, acceptance,
      latestRun: latest ? { id: latest.id, status: latest.status, attempt: latest.attempt, finishedAt: latest.finished_at } : null,
      updatedAt: row.updated_at,
    };
  }

  listTasks(requirementId) {
    return this.db.prepare('SELECT id FROM tasks WHERE requirement_id = ? ORDER BY id').all(requirementId)
      .map((r) => this.getTask(r.id));
  }

  updateTask(id, patch, guard) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return { error: 'not_found' };
    if (guard !== undefined && row.version !== guard) return { error: 'conflict', current: this.getTask(id) };
    return transaction(this.db, () => ({
      data: this.upsertTask({
        id, requirementId: row.requirement_id, title: patch.title, objective: patch.objective,
        autonomy: patch.autonomy, deps: patch.deps,
        scope: patch.scope, verify: patch.verify, acceptance: patch.acceptance,
      }),
    }));
  }

  // ---------- DAG / status derivation（服务端计算，客户端不算） ----------

  computeDag(requirementId) {
    const tasks = this.listTasks(requirementId);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const indeg = new Map(tasks.map((t) => [t.id, t.deps.filter((d) => byId.has(d)).length]));
    const layers = [];
    let frontier = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id).sort();
    const seen = new Set();
    while (frontier.length) {
      layers.push(frontier);
      const next = [];
      for (const id of frontier) {
        seen.add(id);
        for (const t of tasks) {
          if (!t.deps.includes(id)) continue;
          const n = indeg.get(t.id) - 1;
          indeg.set(t.id, n);
          if (n === 0 && !seen.has(t.id)) next.push(t.id);
        }
      }
      frontier = next.sort();
    }
    const edges = tasks.flatMap((t) => t.deps.map((d) => ({ from: d, to: t.id })));
    const nodes = tasks.map((t) => {
      const evidenceCount = this.db.prepare(`SELECT COUNT(*) AS n FROM evidence e JOIN runs r ON r.id = e.run_id WHERE r.task_id = ?`).get(t.id).n;
      return {
        id: t.id, title: t.title, status: t.status,
        layer: layers.findIndex((l) => l.includes(t.id)),
        deps: t.deps, latestRunId: t.latestRun?.id ?? null, evidenceCount,
      };
    });
    const stats = { total: tasks.length, passed: 0, failed: 0, blocked: 0 };
    for (const t of tasks) {
      if (t.status === 'passed') stats.passed++;
      else if (t.status === 'failed') stats.failed++;
      else if (t.status === 'blocked') stats.blocked++;
    }
    return {
      requirementId, layers, nodes, edges, stats,
      validated: seen.size === tasks.length,
      validationErrors: seen.size === tasks.length ? [] : ['存在环或不可达任务'],
    };
  }

  /** 由 runs 推导任务状态；依赖未通过则为 blocked。服务端唯一的状态来源。 */
  recomputeStatuses(requirementId) {
    const tasks = this.listTasks(requirementId);
    const statusOf = new Map(tasks.map((t) => [t.id, t.status]));
    const dag = this.computeDag(requirementId);
    for (const layer of dag.layers) {
      for (const id of layer) {
        const t = tasks.find((x) => x.id === id);
        let status;
        const latest = t.latestRun;
        if (latest?.status === 'running' || latest?.status === 'queued') status = 'running';
        else if (latest?.status === 'passed') status = 'passed';
        else if (latest?.status === 'failed') status = 'failed';
        else if (!t.deps.length) status = 'ready';
        else if (t.deps.every((d) => statusOf.get(d) === 'passed')) status = 'ready';
        else status = 'blocked';
        statusOf.set(id, status);
        if (status !== t.status) {
          this.db.prepare('UPDATE tasks SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
        }
      }
    }
    // DAG 层级也落库，面板直接读
    for (const [i, layer] of dag.layers.entries()) {
      for (const id of layer) this.db.prepare('UPDATE tasks SET dag_layer=? WHERE id=?').run(i, id);
    }
  }

  // ---------- runs ----------

  nextAttempt(taskId) {
    const row = this.db.prepare('SELECT MAX(attempt) AS m FROM runs WHERE task_id = ?').get(taskId);
    return (row?.m ?? 0) + 1;
  }

  createRun({ taskId, actor, agentProfile }) {
    const runId = `run_${taskId}_${this.nextAttempt(taskId)}`;
    this.db.prepare(`INSERT INTO runs (id,task_id,attempt,status,actor,agent_profile,created_at)
                     VALUES (?,?,?, 'queued', ?,?,?)`)
      .run(runId, taskId, Number(runId.split('_').pop()), actor ?? 'system', agentProfile ?? null, now());
    this.recomputeStatuses(this.db.prepare('SELECT requirement_id FROM tasks WHERE id=?').get(taskId).requirement_id);
    return this.getRun(runId);
  }

  getRun(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    if (!row) return null;
    const stages = this.db.prepare('SELECT * FROM run_stages WHERE run_id = ? ORDER BY seq').all(id)
      .map((s) => ({ seq: s.seq, name: s.name, command: s.command, exitCode: s.exit_code, durationMs: s.duration_ms, logEvidenceId: s.log_evidence }));
    return {
      id: row.id, taskId: row.task_id, attempt: row.attempt, status: row.status,
      reason: row.reason, actor: row.actor, agentProfile: row.agent_profile,
      changedFiles: row.changed_files, startedAt: row.started_at, finishedAt: row.finished_at,
      stages,
    };
  }

  listRuns(taskId) {
    return this.db.prepare('SELECT id FROM runs WHERE task_id = ? ORDER BY created_at DESC').all(taskId).map((r) => this.getRun(r.id));
  }

  startRun(runId, { workspace }) {
    this.db.prepare('UPDATE runs SET status=?, started_at=?, workspace=? WHERE id=?').run('running', now(), workspace, runId);
  }

  finishRun(runId, { status, reason, changedFiles }) {
    this.db.prepare('UPDATE runs SET status=?, reason=?, changed_files=?, finished_at=? WHERE id=?')
      .run(status, reason ?? null, changedFiles ?? 0, now(), runId);
    const run = this.getRun(runId);
    this.recomputeStatuses(this.db.prepare('SELECT requirement_id FROM tasks WHERE id=?').get(run.taskId).requirement_id);
    this.addEvent({ kind: 'run.finished', taskId: run.taskId, runId, payload: { status, reason } });
    return run;
  }

  addStage(runId, { seq, name, command, exitCode, durationMs, logEvidenceId }) {
    this.db.prepare(`INSERT OR REPLACE INTO run_stages (run_id,seq,name,command,exit_code,duration_ms,log_evidence)
                     VALUES (?,?,?,?,?,?,?)`).run(runId, seq, name, command, exitCode, durationMs, logEvidenceId ?? null);
  }

  addChange(runId, { path, inScope, reason }) {
    this.db.prepare('INSERT OR REPLACE INTO run_changes (run_id,path,in_scope,reason) VALUES (?,?,?,?)')
      .run(runId, path, inScope ? 1 : 0, reason ?? null);
  }

  listChanges(runId) {
    return this.db.prepare('SELECT * FROM run_changes WHERE run_id = ? ORDER BY path').all(runId)
      .map((r) => ({ path: r.path, inScope: !!r.in_scope, reason: r.reason }));
  }

  // ---------- evidence ----------

  addEvidence({ id, runId, kind, relPath, sha256, bytes }) {
    this.db.prepare('INSERT OR REPLACE INTO evidence (id,run_id,kind,rel_path,sha256,bytes,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, runId, kind, relPath, sha256, bytes, now());
    return id;
  }

  listEvidence(runId) {
    return this.db.prepare('SELECT * FROM evidence WHERE run_id = ? ORDER BY kind, id').all(runId)
      .map((r) => ({ id: r.id, runId: r.run_id, kind: r.kind, sha256: r.sha256, bytes: r.bytes, createdAt: r.created_at, contentUrl: `/api/v1/evidence/${r.id}/content` }));
  }

  getEvidence(id) {
    const r = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, runId: r.run_id, kind: r.kind, relPath: r.rel_path, sha256: r.sha256, bytes: r.bytes, createdAt: r.created_at };
  }

  // ---------- card sync ----------

  getCardSync(kind, cardId) {
    const r = this.db.prepare('SELECT * FROM card_sync WHERE kind = ? AND card_id = ?').get(kind, cardId);
    if (!r) return null;
    return {
      kind: r.kind, cardId: r.card_id, projectId: r.project_id, filePath: r.file_path,
      baseDbSha: r.base_db_sha, baseFileSha: r.base_file_sha, syncedAt: r.synced_at,
    };
  }

  upsertCardSync({ kind, cardId, projectId, filePath, baseDbSha, baseFileSha }) {
    this.db.prepare(`INSERT INTO card_sync (kind,card_id,project_id,file_path,base_db_sha,base_file_sha,synced_at)
                     VALUES (?,?,?,?,?,?,?)
                     ON CONFLICT(kind,card_id) DO UPDATE SET
                       project_id=excluded.project_id, file_path=excluded.file_path,
                       base_db_sha=excluded.base_db_sha, base_file_sha=excluded.base_file_sha,
                       synced_at=excluded.synced_at`)
      .run(kind, cardId, projectId, filePath, baseDbSha, baseFileSha, now());
  }

  listCardSync(projectId) {
    return this.db.prepare('SELECT * FROM card_sync WHERE project_id = ?').all(projectId).map((r) => ({
      kind: r.kind, cardId: r.card_id, filePath: r.file_path,
      baseDbSha: r.base_db_sha, baseFileSha: r.base_file_sha, syncedAt: r.synced_at,
    }));
  }
  // ---------- agent config ----------

  upsertAgentProfile(p) {
    this.db.prepare(`INSERT OR REPLACE INTO agent_profiles (id,project_id,role,adapter,model,command,env_json,policy_json,schema_version,created_at,updated_at)
                     VALUES (?,?,?,?,?,?,?,?, 'agent/v1', ?, ?)`)
      .run(p.id, p.projectId ?? null, p.role, p.adapter, p.model ?? null, p.command ?? null,
        J(p.env), J(p.policy), now(), now());
  }

  listAgentProfiles(projectId) {
    const rows = this.db.prepare('SELECT * FROM agent_profiles WHERE project_id IS NULL OR project_id = ? ORDER BY role, id').all(projectId);
    return rows.map((r) => ({
      id: r.id, projectId: r.project_id, role: r.role, adapter: r.adapter,
      model: r.model, command: r.command, env: P(r.env_json), policy: P(r.policy_json),
      schemaVersion: r.schema_version,
    }));
  }

  // ---------- events ----------

  addEvent({ kind, projectId, requirementId, taskId, runId, payload }) {
    this.db.prepare('INSERT INTO events (project_id,requirement_id,task_id,run_id,kind,payload_json,at) VALUES (?,?,?,?,?,?,?)')
      .run(projectId ?? null, requirementId ?? null, taskId ?? null, runId ?? null, kind, J(payload ?? {}), now());
  }

  listEvents({ projectId, since = 0, limit = 100 }) {
    // 取“最新的 N 条”再按时间正序返回：面板看的是最近事件，增量轮询看的是 since 之后的事件
    const rows = projectId
      ? this.db.prepare(`SELECT * FROM (SELECT * FROM events WHERE project_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`)
        .all(projectId, since, limit)
      : this.db.prepare(`SELECT * FROM (SELECT * FROM events WHERE id > ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`)
        .all(since, limit);
    return rows.map((r) => ({
      id: r.id, kind: r.kind, at: r.at, projectId: r.project_id, requirementId: r.requirement_id,
      taskId: r.task_id, runId: r.run_id, payload: P(r.payload_json),
    }));
  }
}
