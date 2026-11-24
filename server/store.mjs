// 仓储层（PostgreSQL）：所有 SQL 收敛在这里，API 层不写 SQL。
// 原则：派生状态（任务状态、DAG 层级、统计）在这里算好写回，客户端只读不算。
// 与 SQLite 时代相比：全部方法异步，占位符 $1..$n，布尔用 true/false。

import crypto from 'node:crypto';
import { now, num, withTransaction } from './db.mjs';

const J = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const P = (v) => (v === null || v === undefined ? null : JSON.parse(v));

export class Store {
  constructor(pool) {
    this.pool = pool;
  }

  async _one(sql, params = [], client) {
    const r = await (client ?? this.pool).query(sql, params);
    return r.rows[0] ?? null;
  }

  async _all(sql, params = [], client) {
    const r = await (client ?? this.pool).query(sql, params);
    return r.rows;
  }

  async _run(sql, params = [], client) {
    const r = await (client ?? this.pool).query(sql, params);
    return r.rowCount;
  }

  // ---------- projects ----------

  mapProject(row) {
    if (!row) return null;
    return {
      id: row.id, name: row.name, stack: row.stack, repoPath: row.repo_path,
      defaultBranch: row.default_branch, cardsMode: row.cards_mode, status: row.status,
      schemaVersion: row.schema_version, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async upsertProject(p) {
    const existing = await this.getProject(p.id);
    const at = now();
    if (existing) {
      await this._run(
        `UPDATE projects SET name=$1, stack=$2, repo_path=$3, default_branch=$4, cards_mode=$5, updated_at=$6 WHERE id=$7`,
        [p.name ?? existing.name, p.stack ?? existing.stack, p.repoPath ?? existing.repoPath,
          p.defaultBranch ?? existing.defaultBranch, p.cardsMode ?? existing.cardsMode, at, p.id],
      );
      return this.getProject(p.id);
    }
    await this._run(
      `INSERT INTO projects (id,name,stack,repo_path,default_branch,cards_mode,status,schema_version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'active','project/v1',$7,$8)`,
      [p.id, p.name ?? p.id, p.stack ?? 'custom', p.repoPath, p.defaultBranch ?? 'main', p.cardsMode ?? 'platform', at, at],
    );
    return this.getProject(p.id);
  }

  async getProject(id) {
    return this.mapProject(await this._one('SELECT * FROM projects WHERE id = $1', [id]));
  }

  async listProjects() {
    const rows = await this._all('SELECT * FROM projects ORDER BY id');
    return rows.map((r) => this.mapProject(r));
  }

  async projectStats(projectId) {
    const rows = await this._all(
      `SELECT t.status AS status, COUNT(*) AS n FROM tasks t
       JOIN requirements r ON r.id = t.requirement_id
       WHERE r.project_id = $1 GROUP BY t.status`,
      [projectId],
    );
    const req = await this._one('SELECT COUNT(*) AS n FROM requirements WHERE project_id = $1', [projectId]);
    const by = Object.fromEntries(rows.map((r) => [r.status, num(r.n)]));
    return {
      requirements: num(req?.n),
      tasks: rows.reduce((a, r) => a + num(r.n), 0),
      passed: by.passed ?? 0,
      failed: by.failed ?? 0,
    };
  }

  // ---------- 全局计数（health 用） ----------

  async counts() {
    const row = await this._one(
      `SELECT
         (SELECT COUNT(*) FROM projects)     AS projects,
         (SELECT COUNT(*) FROM requirements) AS requirements,
         (SELECT COUNT(*) FROM tasks)        AS tasks,
         (SELECT COUNT(*) FROM runs)         AS runs,
         (SELECT COUNT(*) FROM evidence)     AS evidence`,
    );
    return { projects: num(row.projects), requirements: num(row.requirements), tasks: num(row.tasks), runs: num(row.runs), evidence: num(row.evidence) };
  }

  // ---------- config snapshots ----------

  async saveConfig(projectId, resolved, sources) {
    const json = JSON.stringify(resolved);
    const sha256 = crypto.createHash('sha256').update(json).digest('hex');
    const prev = await this.latestConfig(projectId);
    if (prev && prev.sha256 === sha256) return prev;
    const version = (prev?.version ?? 0) + 1;
    await this._run(
      `INSERT INTO project_configs (id,project_id,version,resolved_json,sources_json,sha256,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`cfg_${projectId}_${version}`, projectId, version, json, JSON.stringify(sources), sha256, now()],
    );
    return this.latestConfig(projectId);
  }

  async latestConfig(projectId) {
    const row = await this._one('SELECT * FROM project_configs WHERE project_id = $1 ORDER BY version DESC LIMIT 1', [projectId]);
    if (!row) return null;
    return {
      projectId: row.project_id, version: row.version,
      resolved: P(row.resolved_json), sources: P(row.sources_json),
      sha256: row.sha256, createdAt: row.created_at,
    };
  }

  // ---------- requirements ----------

  async upsertRequirement(req, client) {
    const at = now();
    const existing = await this._one('SELECT version FROM requirements WHERE id = $1', [req.id], client);
    if (existing) {
      await this._run(
        `UPDATE requirements SET project_id=$1, title=$2, status=$3, autonomy=$4, owner=$5, summary=$6,
           version=version+1, updated_at=$7 WHERE id=$8`,
        [req.projectId, req.title, req.status, req.autonomy, req.owner ?? null, req.summary ?? null, at, req.id],
        client,
      );
    } else {
      await this._run(
        `INSERT INTO requirements (id,project_id,title,status,autonomy,owner,summary,version,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`,
        [req.id, req.projectId, req.title, req.status, req.autonomy, req.owner ?? null, req.summary ?? null, at, at],
        client,
      );
    }
    await this._run('DELETE FROM acceptance_criteria WHERE requirement_id = $1', [req.id], client);
    for (const [i, ac] of (req.acceptance || []).entries()) {
      await this._run(
        'INSERT INTO acceptance_criteria (requirement_id,id,seq,text,verify_by) VALUES ($1,$2,$3,$4,$5)',
        [req.id, ac.id, i, ac.text, ac.verifyBy],
        client,
      );
    }
    return this.getRequirement(req.id, client);
  }

  async getRequirement(id, client) {
    const row = await this._one('SELECT * FROM requirements WHERE id = $1', [id], client);
    if (!row) return null;
    const acceptance = (await this._all(
      'SELECT * FROM acceptance_criteria WHERE requirement_id = $1 ORDER BY seq',
      [id],
      client,
    )).map((r) => ({ id: r.id, seq: r.seq, text: r.text, verifyBy: r.verify_by }));
    return {
      id: row.id, projectId: row.project_id, title: row.title, status: row.status,
      autonomy: row.autonomy, owner: row.owner, summary: row.summary, version: row.version,
      acceptance, createdAt: row.created_at, updatedAt: row.updated_at,
      stats: await this.requirementStats(row.id, client),
    };
  }

  async requirementStats(requirementId, client) {
    const rows = await this._all(
      'SELECT status, COUNT(*) AS n FROM tasks WHERE requirement_id = $1 GROUP BY status',
      [requirementId],
      client,
    );
    const by = Object.fromEntries(rows.map((r) => [r.status, num(r.n)]));
    return { tasks: rows.reduce((a, r) => a + num(r.n), 0), passed: by.passed ?? 0, failed: by.failed ?? 0 };
  }

  async listRequirements(projectId) {
    const rows = await this._all('SELECT id FROM requirements WHERE project_id = $1 ORDER BY id', [projectId]);
    const out = [];
    for (const r of rows) out.push(await this.getRequirement(r.id));
    return out;
  }

  async updateRequirement(id, patch, guard) {
    const row = await this._one('SELECT * FROM requirements WHERE id = $1', [id]);
    if (!row) return { error: 'not_found' };
    if (guard !== undefined && row.version !== guard) return { error: 'conflict', current: await this.getRequirement(id) };

    return withTransaction(this.pool, async (client) => ({
      data: await this.upsertRequirement({
        id, projectId: row.project_id, title: patch.title, status: patch.status,
        autonomy: patch.autonomy, owner: patch.owner, summary: patch.summary,
        acceptance: patch.acceptance,
      }, client),
    }));
  }

  // ---------- tasks ----------

  async upsertTask(task, client) {
    const at = now();
    const existing = await this._one('SELECT version FROM tasks WHERE id = $1', [task.id], client);
    if (existing) {
      await this._run(
        `UPDATE tasks SET requirement_id=$1, title=$2, objective=$3, autonomy=$4, version=version+1, updated_at=$5 WHERE id=$6`,
        [task.requirementId, task.title, task.objective ?? null, task.autonomy, at, task.id],
        client,
      );
    } else {
      await this._run(
        `INSERT INTO tasks (id,requirement_id,title,objective,autonomy,status,version,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,'pending',1,$6,$7)`,
        [task.id, task.requirementId, task.title, task.objective ?? null, task.autonomy, at, at],
        client,
      );
    }
    await this._run('DELETE FROM task_deps WHERE task_id = $1', [task.id], client);
    for (const dep of task.deps || []) {
      await this._run('INSERT INTO task_deps (task_id,depends_on) VALUES ($1,$2) ON CONFLICT DO NOTHING', [task.id, dep], client);
    }
    await this._run('DELETE FROM task_scope WHERE task_id = $1', [task.id], client);
    for (const kind of ['write', 'read', 'deny']) {
      for (const pattern of task.scope?.[kind] || []) {
        await this._run('INSERT INTO task_scope (task_id,kind,pattern) VALUES ($1,$2,$3)', [task.id, kind, pattern], client);
      }
    }
    await this._run('DELETE FROM task_verify WHERE task_id = $1', [task.id], client);
    for (const [i, v] of (task.verify || []).entries()) {
      const ref = typeof v === 'string' ? v : v.ref;
      const resolved = typeof v === 'string' ? null : (v.resolvedCommand ?? null);
      await this._run('INSERT INTO task_verify (task_id,seq,ref,resolved_command) VALUES ($1,$2,$3,$4)', [task.id, i, ref, resolved], client);
    }
    await this._run('DELETE FROM task_acceptance WHERE task_id = $1', [task.id], client);
    for (const ac of task.acceptance || []) {
      await this._run('INSERT INTO task_acceptance (task_id,ac_id) VALUES ($1,$2)', [task.id, ac], client);
    }
    return this.getTask(task.id, client);
  }

  async getTask(id, client) {
    const row = await this._one('SELECT * FROM tasks WHERE id = $1', [id], client);
    if (!row) return null;
    const deps = (await this._all('SELECT depends_on FROM task_deps WHERE task_id = $1 ORDER BY depends_on', [id], client))
      .map((r) => r.depends_on);
    const scope = { write: [], read: [], deny: [] };
    for (const r of await this._all('SELECT kind,pattern FROM task_scope WHERE task_id = $1', [id], client)) scope[r.kind].push(r.pattern);
    const verify = (await this._all('SELECT seq,ref,resolved_command FROM task_verify WHERE task_id = $1 ORDER BY seq', [id], client))
      .map((r) => ({ seq: r.seq, ref: r.ref, resolvedCommand: r.resolved_command }));
    const acceptance = (await this._all('SELECT ac_id FROM task_acceptance WHERE task_id = $1 ORDER BY ac_id', [id], client))
      .map((r) => r.ac_id);
    const latest = await this._one('SELECT * FROM runs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1', [id], client);
    return {
      id: row.id, requirementId: row.requirement_id, title: row.title, objective: row.objective,
      autonomy: row.autonomy, status: row.status, dagLayer: row.dag_layer, version: row.version,
      deps, scope, verify, acceptance,
      latestRun: latest ? { id: latest.id, status: latest.status, attempt: latest.attempt, finishedAt: latest.finished_at } : null,
      updatedAt: row.updated_at,
    };
  }

  async listTasks(requirementId) {
    const rows = await this._all('SELECT id FROM tasks WHERE requirement_id = $1 ORDER BY id', [requirementId]);
    const out = [];
    for (const r of rows) out.push(await this.getTask(r.id));
    return out;
  }

  async updateTask(id, patch, guard) {
    const row = await this._one('SELECT * FROM tasks WHERE id = $1', [id]);
    if (!row) return { error: 'not_found' };
    if (guard !== undefined && row.version !== guard) return { error: 'conflict', current: await this.getTask(id) };

    return withTransaction(this.pool, async (client) => ({
      data: await this.upsertTask({
        id, requirementId: row.requirement_id, title: patch.title, objective: patch.objective,
        autonomy: patch.autonomy, deps: patch.deps,
        scope: patch.scope, verify: patch.verify, acceptance: patch.acceptance,
      }, client),
    }));
  }

  // ---------- DAG / 状态推导（服务端计算，客户端不算） ----------

  async computeDag(requirementId) {
    const tasks = await this.listTasks(requirementId);
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

    const evRows = await this._all(
      `SELECT r.task_id AS task_id, COUNT(*) AS n FROM evidence e
       JOIN runs r ON r.id = e.run_id
       JOIN tasks t ON t.id = r.task_id
       WHERE t.requirement_id = $1 GROUP BY r.task_id`,
      [requirementId],
    );
    const evByTask = new Map(evRows.map((r) => [r.task_id, num(r.n)]));

    const edges = tasks.flatMap((t) => t.deps.map((d) => ({ from: d, to: t.id })));
    const nodes = tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status,
      layer: layers.findIndex((l) => l.includes(t.id)),
      deps: t.deps, latestRunId: t.latestRun?.id ?? null, evidenceCount: evByTask.get(t.id) ?? 0,
    }));

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
  async recomputeStatuses(requirementId) {
    const tasks = await this.listTasks(requirementId);
    const statusOf = new Map(tasks.map((t) => [t.id, t.status]));
    const dag = await this.computeDag(requirementId);

    for (const layer of dag.layers) {
      for (const id of layer) {
        const t = tasks.find((x) => x.id === id);
        const latest = t.latestRun;
        let status;
        if (latest?.status === 'running' || latest?.status === 'queued') status = 'running';
        else if (latest?.status === 'passed') status = 'passed';
        else if (latest?.status === 'failed') status = 'failed';
        else if (!t.deps.length) status = 'ready';
        else if (t.deps.every((d) => statusOf.get(d) === 'passed')) status = 'ready';
        else status = 'blocked';
        statusOf.set(id, status);
        if (status !== t.status) {
          await this._run('UPDATE tasks SET status=$1, updated_at=$2 WHERE id=$3', [status, now(), id]);
        }
      }
    }
    for (const [i, layer] of dag.layers.entries()) {
      for (const id of layer) await this._run('UPDATE tasks SET dag_layer=$1 WHERE id=$2', [i, id]);
    }
  }

  // ---------- runs ----------

  async nextAttempt(taskId) {
    const row = await this._one('SELECT MAX(attempt) AS m FROM runs WHERE task_id = $1', [taskId]);
    return num(row?.m) + 1;
  }

  async createRun({ taskId, actor, agentProfile }) {
    const attempt = await this.nextAttempt(taskId);
    const runId = `run_${taskId}_${attempt}`;
    await this._run(
      `INSERT INTO runs (id,task_id,attempt,status,actor,agent_profile,created_at)
       VALUES ($1,$2,$3,'queued',$4,$5,$6)`,
      [runId, taskId, attempt, actor ?? 'system', agentProfile ?? null, now()],
    );
    const task = await this._one('SELECT requirement_id FROM tasks WHERE id = $1', [taskId]);
    await this.recomputeStatuses(task.requirement_id);
    return this.getRun(runId);
  }

  /** 归档导入用：按显式 id/attempt 写入（幂等，重复导入同一条会覆盖）。 */
  async upsertRun({ id, taskId, attempt, status, reason, actor, agentProfile, workspace, changedFiles, startedAt, finishedAt, createdAt }) {
    await this._run(
      `INSERT INTO runs (id,task_id,attempt,status,reason,actor,agent_profile,workspace,changed_files,started_at,finished_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         status=EXCLUDED.status, reason=EXCLUDED.reason, changed_files=EXCLUDED.changed_files,
         started_at=EXCLUDED.started_at, finished_at=EXCLUDED.finished_at`,
      [id, taskId, attempt, status, reason ?? null, actor ?? 'seed', agentProfile ?? null, workspace ?? null,
        changedFiles ?? 0, startedAt ?? null, finishedAt ?? null, createdAt ?? now()],
    );
    return id;
  }

  async getRun(id) {
    const row = await this._one('SELECT * FROM runs WHERE id = $1', [id]);
    if (!row) return null;
    const stages = (await this._all('SELECT * FROM run_stages WHERE run_id = $1 ORDER BY seq', [id]))
      .map((s) => ({ seq: s.seq, name: s.name, command: s.command, exitCode: s.exit_code, durationMs: s.duration_ms, logEvidenceId: s.log_evidence }));
    return {
      id: row.id, taskId: row.task_id, attempt: row.attempt, status: row.status,
      reason: row.reason, actor: row.actor, agentProfile: row.agent_profile,
      changedFiles: row.changed_files, startedAt: row.started_at, finishedAt: row.finished_at,
      stages,
    };
  }

  async listRuns(taskId) {
    const rows = await this._all('SELECT id FROM runs WHERE task_id = $1 ORDER BY created_at DESC', [taskId]);
    const out = [];
    for (const r of rows) out.push(await this.getRun(r.id));
    return out;
  }

  async startRun(runId, { workspace }) {
    await this._run('UPDATE runs SET status=$1, started_at=$2, workspace=$3 WHERE id=$4', ['running', now(), workspace ?? null, runId]);
  }

  async finishRun(runId, { status, reason, changedFiles }) {
    await this._run('UPDATE runs SET status=$1, reason=$2, changed_files=$3, finished_at=$4 WHERE id=$5',
      [status, reason ?? null, changedFiles ?? 0, now(), runId]);
    const run = await this.getRun(runId);
    const task = await this._one('SELECT requirement_id FROM tasks WHERE id = $1', [run.taskId]);
    await this.recomputeStatuses(task.requirement_id);
    await this.addEvent({ kind: 'run.finished', taskId: run.taskId, runId, payload: { status, reason } });
    return run;
  }

  async addStage(runId, { seq, name, command, exitCode, durationMs, logEvidenceId }) {
    await this._run(
      `INSERT INTO run_stages (run_id,seq,name,command,exit_code,duration_ms,log_evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (run_id,seq) DO UPDATE SET
         name=EXCLUDED.name, command=EXCLUDED.command, exit_code=EXCLUDED.exit_code,
         duration_ms=EXCLUDED.duration_ms, log_evidence=EXCLUDED.log_evidence`,
      [runId, seq, name, command, exitCode ?? null, durationMs ?? null, logEvidenceId ?? null],
    );
  }

  async addChange(runId, { path, inScope, reason }) {
    await this._run(
      `INSERT INTO run_changes (run_id,path,in_scope,reason) VALUES ($1,$2,$3,$4)
       ON CONFLICT (run_id,path) DO UPDATE SET in_scope=EXCLUDED.in_scope, reason=EXCLUDED.reason`,
      [runId, path, !!inScope, reason ?? null],
    );
  }

  async listChanges(runId) {
    const rows = await this._all('SELECT * FROM run_changes WHERE run_id = $1 ORDER BY path', [runId]);
    return rows.map((r) => ({ path: r.path, inScope: r.in_scope, reason: r.reason }));
  }

  async hasEventForRun(runId) {
    const row = await this._one('SELECT 1 AS ok FROM events WHERE run_id = $1 LIMIT 1', [runId]);
    return !!row;
  }

  // ---------- evidence ----------

  async addEvidence({ id, runId, kind, relPath, sha256, bytes }) {
    await this._run(
      `INSERT INTO evidence (id,run_id,kind,rel_path,sha256,bytes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET sha256=EXCLUDED.sha256, bytes=EXCLUDED.bytes`,
      [id, runId, kind, relPath, sha256, bytes, now()],
    );
    return id;
  }

  async listEvidence(runId) {
    const rows = await this._all('SELECT * FROM evidence WHERE run_id = $1 ORDER BY kind, id', [runId]);
    return rows.map((r) => ({
      id: r.id, runId: r.run_id, kind: r.kind, sha256: r.sha256, bytes: r.bytes,
      createdAt: r.created_at, contentUrl: `/api/v1/evidence/${r.id}/content`,
    }));
  }

  async getEvidence(id) {
    const r = await this._one('SELECT * FROM evidence WHERE id = $1', [id]);
    if (!r) return null;
    return { id: r.id, runId: r.run_id, kind: r.kind, relPath: r.rel_path, sha256: r.sha256, bytes: r.bytes, createdAt: r.created_at };
  }

  // ---------- card sync ----------

  async getCardSync(kind, cardId) {
    const r = await this._one('SELECT * FROM card_sync WHERE kind = $1 AND card_id = $2', [kind, cardId]);
    if (!r) return null;
    return {
      kind: r.kind, cardId: r.card_id, projectId: r.project_id, filePath: r.file_path,
      baseDbSha: r.base_db_sha, baseFileSha: r.base_file_sha, syncedAt: r.synced_at,
    };
  }

  async upsertCardSync({ kind, cardId, projectId, filePath, baseDbSha, baseFileSha }) {
    await this._run(
      `INSERT INTO card_sync (kind,card_id,project_id,file_path,base_db_sha,base_file_sha,synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (kind,card_id) DO UPDATE SET
         project_id=EXCLUDED.project_id, file_path=EXCLUDED.file_path,
         base_db_sha=EXCLUDED.base_db_sha, base_file_sha=EXCLUDED.base_file_sha, synced_at=EXCLUDED.synced_at`,
      [kind, cardId, projectId, filePath, baseDbSha, baseFileSha, now()],
    );
  }

  async listCardSync(projectId) {
    const rows = await this._all('SELECT * FROM card_sync WHERE project_id = $1', [projectId]);
    return rows.map((r) => ({
      kind: r.kind, cardId: r.card_id, filePath: r.file_path,
      baseDbSha: r.base_db_sha, baseFileSha: r.base_file_sha, syncedAt: r.synced_at,
    }));
  }

  // ---------- agent config ----------

  async upsertAgentProfile(p) {
    await this._run(
      `INSERT INTO agent_profiles (id,project_id,role,adapter,model,command,env_json,policy_json,schema_version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'agent/v1',$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         role=EXCLUDED.role, adapter=EXCLUDED.adapter, model=EXCLUDED.model, command=EXCLUDED.command,
         env_json=EXCLUDED.env_json, policy_json=EXCLUDED.policy_json, updated_at=EXCLUDED.updated_at`,
      [p.id, p.projectId ?? null, p.role, p.adapter, p.model ?? null, p.command ?? null,
        J(p.env), J(p.policy), now(), now()],
    );
  }

  async listAgentProfiles(projectId) {
    const rows = await this._all('SELECT * FROM agent_profiles WHERE project_id IS NULL OR project_id = $1 ORDER BY role, id', [projectId]);
    return rows.map((r) => ({
      id: r.id, projectId: r.project_id, role: r.role, adapter: r.adapter,
      model: r.model, command: r.command, env: P(r.env_json), policy: P(r.policy_json),
      schemaVersion: r.schema_version,
    }));
  }

  // ---------- events ----------

  async addEvent({ kind, projectId, requirementId, taskId, runId, payload }) {
    await this._run(
      'INSERT INTO events (project_id,requirement_id,task_id,run_id,kind,payload_json,at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [projectId ?? null, requirementId ?? null, taskId ?? null, runId ?? null, kind, J(payload ?? {}), now()],
    );
  }

  async listEvents({ projectId, since = 0, limit = 100 }) {
    // 取“最新的 N 条”再按时间正序返回
    const rows = projectId
      ? await this._all(
        `SELECT * FROM (SELECT * FROM events WHERE project_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3) t ORDER BY id ASC`,
        [projectId, since, limit],
      )
      : await this._all(
        `SELECT * FROM (SELECT * FROM events WHERE id > $1 ORDER BY id DESC LIMIT $2) t ORDER BY id ASC`,
        [since, limit],
      );
    return rows.map((r) => ({
      id: num(r.id), kind: r.kind, at: r.at, projectId: r.project_id, requirementId: r.requirement_id,
      taskId: r.task_id, runId: r.run_id, payload: P(r.payload_json),
    }));
  }
}
