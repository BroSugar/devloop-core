// API v1：路由与业务判定。派生状态全部在这里算完，客户端只渲染。
// PostgreSQL 时代：handler 与 handle 都是 async。

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.mjs';
import { PLATFORM_ROOT } from '../platform/lib/config.mjs';
import { computeSyncState, exportCards, importCards } from './cards/sync.mjs';
import { validateCards } from './pipeline/validate.mjs';
import { executeRun } from './pipeline/execute.mjs';

const ok = (data, extra = {}) => ({ status: 200, data, ...extra });
const accepted = (data) => ({ status: 202, data });
const notFound = (message = '资源不存在') => ({ status: 404, error: { code: 'not_found', message } });
const badRequest = (message, details) => ({ status: 400, error: { code: 'bad_request', message, details } });
const conflict = (message, details) => ({ status: 409, error: { code: 'conflict', message, details } });
const validationFailed = (errors) => ({ status: 422, error: { code: 'validation_failed', message: '卡片校验未通过', details: errors } });
const policyDenied = (message) => ({ status: 403, error: { code: 'policy_denied', message } });

function parseIfMatch(value) {
  if (!value) return undefined;
  const m = String(value).match(/v?(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function gateView(store, projectId) {
  return store.latestConfig(projectId).then((cfg) => {
    const resolved = cfg?.resolved?.gates || {};
    const sources = cfg?.sources || {};
    const out = {};
    for (const name of ['build', 'lint', 'test']) {
      const gate = resolved[name];
      out[name] = {
        command: typeof gate === 'string' ? gate : gate?.command ?? null,
        source: sources[`gates.${name}.command`] || 'unknown',
        timeoutMs: typeof gate === 'object' ? gate?.timeout_ms ?? null : null,
      };
    }
    return out;
  });
}

async function projectView(store, project) {
  return { ...project, gates: await gateView(store, project.id), stats: await store.projectStats(project.id) };
}

async function buildFlow(store, requirements) {
  const nodes = [];
  const edges = [];
  let cursor = 40;

  for (const req of requirements) {
    const dag = await store.computeDag(req.id);
    const layerCount = Math.max(1, dag.layers.length);
    nodes.push({
      id: `req:${req.id}`, kind: 'requirement', label: `${req.id} · ${req.title}`,
      status: req.status, requirementId: req.id, x: 24, y: cursor + 30,
    });
    dag.nodes.forEach((node, index) => {
      nodes.push({
        id: `task:${node.id}`, kind: 'task', label: node.id,
        status: node.status, requirementId: req.id, taskId: node.id,
        runId: node.latestRunId,
        x: 300 + (node.layer < 0 ? 0 : node.layer) * 220,
        y: cursor + index * 92,
      });
    });
    for (const id of dag.layers[0] || []) edges.push({ from: `req:${req.id}`, to: `task:${id}` });
    for (const edge of dag.edges) edges.push({ from: `task:${edge.from}`, to: `task:${edge.to}` });
    cursor += layerCount * 92 + 120;
  }
  return { nodes, edges };
}

export function createApi({ store }) {
  const routes = [
    { method: 'GET', pattern: /^\/api\/v1\/health$/, fn: async () => ok({
      status: 'ok',
      db: 'postgres',
      version: '1.0.0',
      counts: await store.counts(),
    }) },

    { method: 'GET', pattern: /^\/api\/v1\/projects$/, fn: async () => {
      const projects = await store.listProjects();
      const out = [];
      for (const p of projects) out.push(await projectView(store, p));
      return ok(out);
    } },

    { method: 'POST', pattern: /^\/api\/v1\/projects$/, fn: async ({ body }) => {
      if (!body?.id) return badRequest('缺少 id');
      const dir = path.join(PLATFORM_ROOT, 'projects', body.id, 'project.yaml');
      if (!fs.existsSync(dir)) return badRequest(`配置不存在：projects/${body.id}/project.yaml（配置权威来源是 Git）`);
      return badRequest('v1 的项目接入走「Git 里的 project.yaml + 重启导入」；在线注册留到 v1.1');
    } },

    { method: 'GET', pattern: /^\/api\/v1\/projects\/([^/]+)$/, fn: async ({ params }) => {
      const project = await store.getProject(params[0]);
      return project ? ok(await projectView(store, project)) : notFound('项目不存在');
    } },

    { method: 'GET', pattern: /^\/api\/v1\/projects\/([^/]+)\/config$/, fn: async ({ params }) => {
      const cfg = await store.latestConfig(params[0]);
      return cfg ? ok(cfg) : notFound('配置快照不存在');
    } },

    { method: 'GET', pattern: /^\/api\/v1\/projects\/([^/]+)\/requirements$/, fn: async ({ params }) => {
      if (!(await store.getProject(params[0]))) return notFound('项目不存在');
      return ok(await store.listRequirements(params[0]));
    } },

    { method: 'GET', pattern: /^\/api\/v1\/projects\/([^/]+)\/panel$/, fn: async ({ params, query }) => {
      const project = await store.getProject(params[0]);
      if (!project) return notFound('项目不存在');
      const requirements = await store.listRequirements(project.id);
      return ok({
        projectId: project.id,
        generatedAt: new Date().toISOString(),
        requirements: requirements.map((r) => ({
          id: r.id, title: r.title, status: r.status, tasks: r.stats.tasks, passed: r.stats.passed,
        })),
        flow: await buildFlow(store, requirements),
        events: await store.listEvents({ projectId: project.id, since: Number(query.since ?? 0), limit: 20 }),
      });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/requirements\/([^/]+)$/, fn: async ({ params }) => {
      const req = await store.getRequirement(params[0]);
      if (!req) return notFound('需求不存在');
      return ok(req, { headers: { ETag: `"v${req.version}"` } });
    } },

    { method: 'PUT', pattern: /^\/api\/v1\/requirements\/([^/]+)$/, fn: async ({ params, body, headers }) => {
      if (!body) return badRequest('缺少请求体');
      const result = await store.updateRequirement(params[0], body, parseIfMatch(headers['if-match']));
      if (result.error === 'not_found') return notFound('需求不存在');
      if (result.error === 'conflict') return conflict('版本冲突，请重新拉取后编辑', [`current version = ${result.current.version}`]);
      await store.addEvent({ kind: 'card.updated', requirementId: params[0], payload: { resource: 'requirement' } });
      return ok(result.data, { headers: { ETag: `"v${result.data.version}"` } });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/requirements\/([^/]+)\/dag$/, fn: async ({ params }) => {
      const req = await store.getRequirement(params[0]);
      if (!req) return notFound('需求不存在');
      const dag = await store.computeDag(req.id);
      const project = await store.getProject(req.projectId);
      const tasks = await store.listTasks(req.id);
      const config = (await store.latestConfig(req.projectId))?.resolved;
      const validation = validateCards({ requirement: req, tasks, project, config, dag });
      return ok({ ...dag, validated: validation.ok, validationErrors: validation.errors, validationWarnings: validation.warnings });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/tasks\/([^/]+)$/, fn: async ({ params }) => {
      const task = await store.getTask(params[0]);
      if (!task) return notFound('任务不存在');
      return ok(task, { headers: { ETag: `"v${task.version}"` } });
    } },

    { method: 'PUT', pattern: /^\/api\/v1\/tasks\/([^/]+)$/, fn: async ({ params, body, headers }) => {
      if (!body) return badRequest('缺少请求体');
      const result = await store.updateTask(params[0], body, parseIfMatch(headers['if-match']));
      if (result.error === 'not_found') return notFound('任务不存在');
      if (result.error === 'conflict') return conflict('版本冲突，请重新拉取后编辑', [`current version = ${result.current.version}`]);
      await store.addEvent({ kind: 'card.updated', taskId: params[0], payload: { resource: 'task' } });
      return ok(result.data, { headers: { ETag: `"v${result.data.version}"` } });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/tasks\/([^/]+)\/runs$/, fn: async ({ params }) => {
      if (!(await store.getTask(params[0]))) return notFound('任务不存在');
      return ok(await store.listRuns(params[0]));
    } },

    { method: 'POST', pattern: /^\/api\/v1\/tasks\/([^/]+)\/runs$/, fn: async ({ params, body }) => {
      const task = await store.getTask(params[0]);
      if (!task) return notFound('任务不存在');
      if (task.autonomy === 'human-only') return policyDenied('任务自治等级为 human-only，必须人工执行');

      const requirement = await store.getRequirement(task.requirementId);
      const project = await store.getProject(requirement.projectId);
      const config = (await store.latestConfig(project.id))?.resolved;
      const dag = await store.computeDag(requirement.id);
      const validation = validateCards({ requirement, tasks: await store.listTasks(requirement.id), project, config, dag });
      if (!validation.ok) return validationFailed(validation.errors);

      const override = body?.localOverride;
      if (override) {
        const profiles = await store.listAgentProfiles(project.id);
        const allowed = profiles.some((p) => p.adapter === override.adapter || p.role === 'implementer');
        if (!allowed) return policyDenied(`执行策略不允许 adapter=${override.adapter}`);
        if (override.adapter === 'openai-compatible' || override.adapter === 'anthropic') {
          return policyDenied('v1 不允许客户端覆盖为远端模型（防止代码出网），请用本地 agent');
        }
      }

      const run = await executeRun(store, { projectId: project.id, taskId: task.id, actor: body?.actor || 'api' });
      return accepted(run);
    } },

    { method: 'GET', pattern: /^\/api\/v1\/runs\/([^/]+)$/, fn: async ({ params }) => {
      const run = await store.getRun(params[0]);
      return run ? ok(run) : notFound('执行记录不存在');
    } },

    { method: 'GET', pattern: /^\/api\/v1\/runs\/([^/]+)\/evidence$/, fn: async ({ params }) => {
      if (!(await store.getRun(params[0]))) return notFound('执行记录不存在');
      return ok(await store.listEvidence(params[0]));
    } },

    { method: 'GET', pattern: /^\/api\/v1\/evidence\/([^/]+)\/content$/, raw: true, fn: async ({ params }) => {
      const ev = await store.getEvidence(params[0]);
      if (!ev) return notFound('证据不存在');
      const file = path.join(DATA_DIR, ev.relPath);
      if (!fs.existsSync(file)) return notFound('证据文件缺失');
      return {
        status: 200,
        text: fs.readFileSync(file, 'utf8'),
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-evidence-sha256': ev.sha256 },
      };
    } },

    { method: 'GET', pattern: /^\/api\/v1\/projects\/([^/]+)\/card-sync$/, fn: async ({ params }) => {
      const project = await store.getProject(params[0]);
      if (!project) return notFound('项目不存在');
      const config = (await store.latestConfig(project.id))?.resolved;
      if (!config) return notFound('配置快照不存在');
      try {
        const state = await computeSyncState(store, project, config);
        return ok({
          projectId: project.id,
          summary: state.summary,
          items: state.items.map((i) => ({
            kind: i.kind, id: i.id, state: i.state, action: i.action, path: i.path,
            dbSha: i.dbSha, fileSha: i.fileSha, baseDbSha: i.baseDbSha, baseFileSha: i.baseFileSha,
          })),
        });
      } catch (e) {
        return badRequest(`卡同步不可用：${e.message}`);
      }
    } },

    { method: 'POST', pattern: /^\/api\/v1\/projects\/([^/]+)\/card-sync\/export$/, fn: async ({ params, body }) => {
      const project = await store.getProject(params[0]);
      if (!project) return notFound('项目不存在');
      const config = (await store.latestConfig(project.id))?.resolved;
      if (!config) return notFound('配置快照不存在');
      try {
        return ok(await exportCards(store, project, config, {
          dryRun: !!body?.dryRun,
          ids: body?.ids,
          prefer: body?.prefer === 'force' ? 'force' : 'safe',
        }));
      } catch (e) {
        return badRequest(`导出失败：${e.message}`);
      }
    } },

    { method: 'POST', pattern: /^\/api\/v1\/projects\/([^/]+)\/card-sync\/import$/, fn: async ({ params, body }) => {
      const project = await store.getProject(params[0]);
      if (!project) return notFound('项目不存在');
      const config = (await store.latestConfig(project.id))?.resolved;
      if (!config) return notFound('配置快照不存在');
      try {
        const result = await importCards(store, project, config, {
          dryRun: !!body?.dryRun, ids: body?.ids, prefer: body?.prefer === 'force' ? 'force' : 'safe',
        });
        for (const req of await store.listRequirements(project.id)) await store.recomputeStatuses(req.id);
        return ok(result);
      } catch (e) {
        return badRequest(`导入失败：${e.message}`);
      }
    } },

    { method: 'GET', pattern: /^\/api\/v1\/prds$/, fn: async ({ query }) => {
      if (!query.projectId) return badRequest('缺少 projectId');
      return ok(await store.listPrds(query.projectId));
    } },

    { method: 'POST', pattern: /^\/api\/v1\/prds$/, fn: async ({ body }) => {
      if (!body?.title) return badRequest('缺少 title');
      if (!body?.projectId) return badRequest('缺少 projectId');
      if (!(await store.getProject(body.projectId))) return notFound('项目不存在');
      const id = body.id ?? `PRD-${Date.now().toString(36)}`;
      const prd = await store.upsertPrd({ id, projectId: body.projectId, title: body.title, content: body.content ?? '' });
      return ok(prd, { headers: { ETag: `"v${prd.version}"` } });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/prds\/([^/]+)$/, fn: async ({ params }) => {
      const prd = await store.getPrd(params[0]);
      if (!prd) return notFound('PRD 不存在');
      return ok(prd, { headers: { ETag: `"v${prd.version}"` } });
    } },

    { method: 'PUT', pattern: /^\/api\/v1\/prds\/([^/]+)$/, fn: async ({ params, body, headers }) => {
      if (!body) return badRequest('缺少请求体');
      const result = await store.updatePrd(params[0], body, parseIfMatch(headers['if-match']));
      if (result.error === 'not_found') return notFound('PRD 不存在');
      if (result.error === 'conflict') return conflict('版本冲突，请重新拉取后编辑', [`current version = ${result.current.version}`]);
      return ok(result.data, { headers: { ETag: `"v${result.data.version}"` } });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/prds\/([^/]+)\/reviews$/, fn: async ({ params }) => {
      if (!(await store.getPrd(params[0]))) return notFound('PRD 不存在');
      return ok(await store.listPrdReviews(params[0]));
    } },

    { method: 'GET', pattern: /^\/api\/v1\/agent-config$/, fn: async ({ query }) => {
      const projectId = query.projectId || (await store.listProjects())[0]?.id;
      if (!projectId) return notFound('没有已注册项目');
      const profiles = await store.listAgentProfiles(projectId);
      const roles = {};
      for (const p of profiles) {
        roles[p.role] ??= { adapter: p.adapter, model: p.model ?? undefined, command: p.command ?? undefined };
      }
      const cfg = (await store.latestConfig(projectId))?.resolved;
      return ok({
        schemaVersion: 'agent/v1',
        schemaUrl: '/contracts/agent.schema.v1.json',
        roles,
        routing: { default: 'decomposer', byRole: {}, byProject: cfg?.ai?.routing ? { [projectId]: cfg.ai.routing } : {} },
        policy: {
          allowNetwork: false,
          allowShell: true,
          allowFileWrite: ['worktree'],
          maxTokensPerRun: 200000,
          denyGlobs: cfg?.policy?.denyWrite ?? [],
          requireHumanApproval: ['human-only'],
        },
        profiles,
        readonly: true,
      });
    } },

    { method: 'GET', pattern: /^\/api\/v1\/events$/, fn: async ({ query }) => ok(await store.listEvents({
      projectId: query.projectId,
      since: Number(query.since ?? 0),
      limit: Math.min(Number(query.limit ?? 100), 500),
    })) },
  ];

  return {
    routes,
    async handle({ method, pathname, query, body, headers }) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const m = pathname.match(route.pattern);
        if (!m) continue;
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        try {
          return await route.fn({ params, query, body, headers });
        } catch (e) {
          if (e.code === 'not_found') return notFound(e.message);
          if (e.code === 'conflict') return conflict(e.message);
          return { status: 500, error: { code: 'internal', message: e.message } };
        }
      }
      return notFound(`没有这个接口：${method} ${pathname}`);
    },
  };
}
