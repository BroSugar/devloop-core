#!/usr/bin/env node
// 平台统一入口。所有命令都通过 --project 选择项目，项目差异 100% 来自配置。
//
//   node platform/cli.mjs projects
//   node platform/cli.mjs doctor --project all
//   node platform/cli.mjs plan --project ledger-cli
//   node platform/cli.mjs new-task --project ledger-cli --template feature ...
//   node platform/cli.mjs prepare --project ledger-cli --task T-102
//   node platform/cli.mjs run     --project ledger-cli --task T-102 [--no-merge]
//   node platform/cli.mjs run     --project ledger-cli --all
//   node platform/cli.mjs agents  --project ledger-cli --role implementer
//   node platform/cli.mjs archive-verify

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolve, PLATFORM_ROOT, listProjects, readYaml } from './lib/config.mjs';
import { planProject, writeGraph, formatPlan, validateTask, validateRequirement, loadTaskCards, taskDeps } from './lib/plan.mjs';
import {
  ensureRepo, prepareWorktree, changedFiles, diffText, commitAll, mergeInto, resetTo,
  resolveVerify, runVerify, git,
} from './lib/runtime.mjs';
import { checkChanges, checkBudget, matchesAny } from './lib/policy.mjs';
import { archiveRun, readIndex, verifyArchive } from './lib/evidence.mjs';
import { loadAi, resolveAgent, buildRequest, describe, promptPath } from './lib/ai.mjs';
import { instantiate, listTemplates } from './lib/template.mjs';

// ---------- 参数 ----------

function parseArgv(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags[a.slice(2)] = next; i++; }
    else flags[a.slice(2)] = true;
  }
  return { positional, flags };
}

const { positional, flags } = parseArgv(process.argv.slice(2));
const command = positional[0];

const fail = (msg) => { console.error(`x ${msg}`); process.exit(1); };
const info = (msg) => console.log(msg);

function getCfg(projectId) {
  if (!projectId || projectId === true) fail('缺少 --project <id>（或 --project all）');
  return resolve(loadConfig(projectId));
}

// ---------- projects ----------

function cmdProjects() {
  const ids = listProjects();
  if (!ids.length) return info('还没有注册任何项目（projects/<id>/project.yaml）');
  info(`已注册 ${ids.length} 个项目：`);
  for (const id of ids) {
    try {
      const cfg = getCfg(id);
      info(`  ${id.padEnd(16)} stack=${cfg.project.stack.padEnd(12)} cards=${cfg.project.cards.mode.padEnd(9)} repo=${path.relative(PLATFORM_ROOT, cfg.project.repo_path)}`);
    } catch (e) {
      info(`  ${id.padEnd(16)} <配置错误> ${e.message}`);
    }
  }
}

// ---------- doctor ----------

function aiWithProjectRouting(projectId, overrides) {
  const ai = loadAi();
  const byProject = ai.routing?.by_project || {};
  return {
    ...ai,
    routing: {
      ...ai.routing,
      by_project: { ...byProject, [projectId]: { ...(byProject[projectId] || {}), ...(overrides || {}) } },
    },
  };
}

function cmdDoctor(projectId) {
  const ids = projectId === 'all' ? listProjects() : [projectId];
  let bad = 0;
  for (const id of ids) {
    const problems = [];
    const warns = [];
    let cfg;
    try { cfg = getCfg(id); } catch (e) { info(`\nPROJECT ${id}\n  x 配置加载失败：${e.message}`); bad++; continue; }
    const p = cfg.project;

    // 仓库
    if (!fs.existsSync(p.repo_path)) {
      problems.push(`仓库路径不存在：${p.repo_path}`);
    } else {
      const g = git(p.repo_path, 'rev-parse --is-inside-work-tree');
      if (g.exitCode !== 0) problems.push('不是 git 仓库');
      else {
        const b = git(p.repo_path, 'rev-parse --abbrev-ref HEAD').out.trim();
        if (b !== p.branch) problems.push(`分支不对：期望 ${p.branch}，当前 ${b}`);
        const dirty = changedFiles(p.repo_path);
        if (dirty.length) warns.push(`工作区有 ${dirty.length} 个未提交变更，执行前需清理`);
      }
    }

    // 卡目录
    if (!fs.existsSync(p.spec_path)) problems.push(`需求卡目录不存在：${p.spec_path}`);
    if (!fs.existsSync(p.tasks_path)) problems.push(`任务卡目录不存在：${p.tasks_path}`);

    // 统一门禁
    for (const name of ['build', 'lint', 'test']) {
      const gate = cfg.gates?.[name];
      if (!gate?.command) warns.push(`缺少统一门禁 ${name}`);
    }

    // 模板
    for (const [kind, tpl] of Object.entries(cfg.templates || {})) {
      if (typeof tpl !== 'string') continue;
      try {
        const f = path.join(PLATFORM_ROOT, 'config/templates', tpl, `${kind}.yaml.tpl`);
        if (!fs.existsSync(f)) problems.push(`模板缺失：${tpl}/${kind}`);
      } catch { /* ignore */ }
    }

    // AI 路由
    const ai = aiWithProjectRouting(p.id, cfg.ai?.routing);
    for (const role of ['decomposer', 'implementer', 'reviewer']) {
      try {
        const r = resolveAgent(ai, role, p.id);
        promptPath(r.agent);
        if (r.provider.api_key_env && !process.env[r.provider.api_key_env]) {
          warns.push(`${role} → ${r.providerName}：环境变量 ${r.provider.api_key_env} 未设置（dry-run 不影响）`);
        }
      } catch (e) {
        problems.push(`AI 角色 ${role} 不可用：${e.message}`);
      }
    }

    info(`\nPROJECT ${id}  ${p.name}`);
    info(`  repo      ${path.relative(PLATFORM_ROOT, p.repo_path)} [${p.branch}]`);
    info(`  stack     ${p.stack}${cfg.sources['gates.build.command'] ? ` (gates ← ${cfg.sources['gates.build.command']})` : ''}`);
    info(`  cards     ${p.cards.mode} · spec=${path.relative(PLATFORM_ROOT, p.spec_path)} · tasks=${path.relative(PLATFORM_ROOT, p.tasks_path)}`);
    for (const name of ['build', 'lint', 'test']) {
      const gate = cfg.gates?.[name];
      const src = cfg.sources[`gates.${name}.command`] || '-';
      info(`  gate ${name.padEnd(6)} ${(gate?.command || '(未配置)').padEnd(38)} ← ${src}`);
    }
    info(`  templates ${Object.entries(cfg.templates || {}).map(([k, v]) => `${k}=${v}`).join(' ') || '(无)'}`);
    for (const w of warns) info(`  ! ${w}`);
    for (const e of problems) info(`  x ${e}`);
    if (!problems.length) info('  ✓ 配置自检通过');
    bad += problems.length ? 1 : 0;
  }
  if (bad) process.exit(1);
}

// ---------- plan ----------

function cmdPlan(projectId) {
  const ids = projectId === 'all' ? listProjects() : [projectId];
  let bad = 0;
  for (const id of ids) {
    const cfg = getCfg(id);
    const result = planProject(cfg);
    info(`\n${formatPlan(cfg, result)}`);
    if (!result.errors.length) writeGraph(cfg, result.graph);
    if (result.warns.length) {
      info('  WARN');
      for (const w of result.warns) info(`    ! ${w}`);
    }
    if (result.errors.length) {
      info('  ERROR');
      for (const e of result.errors) info(`    x ${e}`);
      info(`  分解校验失败：${result.errors.length} 个错误`);
      bad++;
    } else {
      info(`  分解校验通过：${result.taskCards.length} 个任务，${result.layers.length} 层 DAG`);
    }
  }
  if (bad) process.exit(1);
}

// ---------- new-task / new-requirement ----------

function kebab(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function cmdNew(kind, projectId) {
  const cfg = getCfg(projectId);
  const templateName = flags.template || (kind === 'task' ? 'feature' : 'feature');
  const id = flags.id;
  if (!id) fail('缺少 --id');

  const dir = kind === 'task' ? cfg.project.tasks_path : cfg.project.spec_path;
  const slug = flags['file-name'] || kebab(flags.title || '') || kind;
  const outFile = path.join(dir, `${id}${slug ? `-${slug}` : ''}.yaml`);

  const vars = {
    id,
    title: flags.title || id,
    requirement: flags.requirement || '',
    autonomy: flags.autonomy || 'auto',
    owner: flags.owner || 'product',
    status: flags.status || 'draft',
    summary: String(flags.summary || '').replace(/\\n/g, '\n'),
    objective: String(flags.objective || '').replace(/\\n/g, '\n'),
    depends_on: flags.depends ? String(flags.depends).split(',').map((s) => s.trim()).join(', ') : '',
    acceptance: flags.acceptance ? String(flags.acceptance).split(',').map((s) => s.trim()).join(', ') : '',
    write: String(flags.write || '').split(',').filter(Boolean).map((s) => `- ${s.trim()}`).join('\n'),
    verify: String(flags.verify || 'build,lint,test').split(',').filter(Boolean).map((s) => `- ${s.trim()}`).join('\n'),
    acceptance_block: String(flags['acceptance-block'] || '').replace(/\\n/g, '\n'),
    regression_of: flags['regression-of'] || '',
    reproduced_by: flags['reproduced-by'] || '',
  };

  const { file } = instantiate({
    template: templateName,
    kind,
    vars,
    outFile,
    force: !!flags.force,
  });

  // 生成即校验：模板保证结构，这里兜底确认产物真的是合法卡
  const card = readYaml(file);
  const errs = kind === 'task' ? validateTask(card) : validateRequirement(card);
  info(`已生成 ${path.relative(PLATFORM_ROOT, file)}  (template=${templateName})`);
  if (errs.length) {
    info('  生成结果不合法（请补齐参数）：');
    for (const e of errs) info(`    x ${e}`);
    process.exit(1);
  }
  info('  产物校验通过');
}

// ---------- prepare / run ----------

function nextAttempt(projectId, taskId) {
  const dir = path.join(PLATFORM_ROOT, 'runs', projectId, taskId);
  if (!fs.existsSync(dir)) return 1;
  return fs.readdirSync(dir).filter((d) => /^attempt-\d+$/.test(d)).length + 1;
}

function cmdPrepare(projectId) {
  const cfg = getCfg(projectId);
  ensureRepo(cfg);
  const { wt } = prepareWorktree(cfg, flags.task, { fresh: !!flags.fresh });
  info(`worktree 就绪：${path.relative(PLATFORM_ROOT, wt)}`);
}

function cmdRun(projectId, taskId) {
  const cfg = getCfg(projectId);
  ensureRepo(cfg);
  const cards = loadTaskCards(cfg);
  const card = cards.find((c) => c.id === taskId);
  if (!card) fail(`找不到任务卡 ${taskId}（${cfg.project.tasks_path}）`);
  const errs = validateTask(card);
  if (errs.length) fail(`任务卡不合法：\n  ${errs.join('\n  ')}`);

  const { wt, branch } = prepareWorktree(cfg, taskId, { fresh: !!flags.fresh });
  const attempt = nextAttempt(projectId, taskId);
  const runDir = path.join(PLATFORM_ROOT, 'runs', projectId, taskId, `attempt-${attempt}`);
  fs.mkdirSync(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const changed = changedFiles(wt);
  info(`\n[${projectId}] ${taskId}  ${card.title}`);
  info(`  worktree ${path.relative(PLATFORM_ROOT, wt)}  attempt=${attempt}  变更=${changed.length}`);

  fs.writeFileSync(path.join(runDir, 'changes.txt'), `${changed.join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'diff.patch'), diffText(wt));

  const finish = (extra) => {
    const result = {
      project: projectId, taskId, attempt, requirement: card.requirement,
      startedAt, finishedAt: new Date().toISOString(),
      changed, ...extra,
    };
    fs.writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    const archived = archiveRun({
      projectId, requirement: card.requirement, taskId, attempt, runDir,
      meta: { verdict: result.verdict, merged: !!result.merged, reason: result.reason, stages: result.stages || [] },
    });
    info(`  证据归档 ${path.relative(PLATFORM_ROOT, archived.dest)}（${archived.files} 个文件）`);
    return result.verdict === 'pass' ? 0 : 1;
  };

  if (!changed.length) {
    // 目标文件被 .gitignore 忽略时不会出现在 diff 里，会静默绕过写域检查 —— 必须显式拦下
    const ignoredEntries = git(wt, 'status --porcelain=v1 -uall --ignored=matching').out
      .split(/\r?\n/)
      .filter((line) => line.startsWith('!! '))
      .map((line) => line.slice(3).trim().replace(/^"|"$/g, '').replace(/\\/g, '/'));
    const ignoredInScope = ignoredEntries.filter((entry) => {
      const base = entry.replace(/\/$/, '');
      if (matchesAny(base, card.scope.write)) return true;
      return (card.scope.write || []).some((w) => w.startsWith(`${base}/`));
    });
    if (ignoredInScope.length) {
      for (const file of ignoredInScope) info(`  x 目标路径被 .gitignore 忽略，不会进入 diff：${file}`);
      return finish({ verdict: 'fail', reason: `.gitignore 屏蔽了写域路径（${ignoredInScope.join(', ')}）` });
    }
    info('  x 没有任何变更，任务未产生实现');
    return finish({ verdict: 'fail', reason: '没有变更' });
  }

  const { violations } = checkChanges(changed, card, cfg.policy);
  const budgets = checkBudget({ files: changed, diffLines: 0, policy: cfg.policy });
  if (violations.length || budgets.length) {
    for (const v of violations) info(`  x 越界 ${v.file}  (${v.reason})`);
    for (const b of budgets) info(`  x ${b}`);
    return finish({ verdict: 'fail', reason: `写域/预算校验失败：${violations.length + budgets.length} 项` });
  }

  const stages = resolveVerify(cfg, card.verify, wt);
  const { verdict, stages: results } = runVerify(stages, { runDir });
  for (const s of results) {
    info(`  ${s.exitCode === 0 ? 'ok  ' : 'FAIL'} ${s.command}  (${s.ms}ms)`);
    if (s.exitCode !== 0) info(s.tail.split('\n').map((l) => `        ${l}`).join('\n'));
  }
  if (verdict !== 'pass') return finish({ verdict: 'fail', reason: '验证未通过', stages: results });

  if (flags['no-merge']) {
    info('  PASS（未合并）');
    return finish({ verdict: 'pass', merged: false, stages: results });
  }

  commitAll(wt, `feat(${taskId}): ${card.title}`);
  try {
    mergeInto(cfg, branch, `merge(${taskId}): ${card.title}`);
  } catch (e) {
    info(`  x ${e.message}`);
    return finish({ verdict: 'fail', reason: '合并失败', stages: results });
  }
  const head = git(cfg.project.repo_path, 'rev-parse HEAD').out.trim();
  const full = runVerify(resolveVerify(cfg, card.verify, cfg.project.repo_path), { runDir: path.join(runDir, 'merge-verify') });
  for (const s of full.stages) {
    info(`  ${s.exitCode === 0 ? 'ok  ' : 'FAIL'} (主仓) ${s.command}`);
    if (s.exitCode !== 0) info(s.tail.split('\n').map((l) => `        ${l}`).join('\n'));
  }
  if (full.verdict !== 'pass') {
    resetTo(cfg, head);
    return finish({ verdict: 'fail', reason: '合并后主仓验证失败，已回滚', stages: results });
  }
  info('  PASS + 已合并');
  return finish({ verdict: 'pass', merged: true, stages: results });
}

function cmdRunAll(projectId) {
  const cfg = getCfg(projectId);
  const cards = loadTaskCards(cfg);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const order = [];
  const done = new Set();
  const visit = (id) => {
    if (done.has(id)) return;
    const c = byId.get(id);
    if (!c) return;
    for (const d of taskDeps(c)) visit(d);
    done.add(id);
    order.push(c.id);
  };
  for (const c of cards) visit(c.id);
  let failed = 0;
  for (const id of order) {
    if (cmdRun(projectId, id) !== 0) { failed++; break; }
  }
  if (failed) process.exit(1);
}

// ---------- agents ----------

function cmdAgents(projectId) {
  const cfg = getCfg(projectId);
  const ai = aiWithProjectRouting(cfg.project.id, cfg.ai?.routing);
  const role = flags.role;
  const roles = role ? [role] : ['decomposer', 'implementer', 'reviewer'];
  for (const r of roles) {
    const resolved = resolveAgent(ai, r, cfg.project.id);
    const promptFile = promptPath(resolved.agent);
    const request = buildRequest({
      agent: resolved.agent,
      provider: resolved.provider,
      system: `role=${r}`,
      user: '<任务输入：需求卡 / 任务卡 / 上下文包>',
    });
    info(`\nrole=${r}  agent=${resolved.agentName}  provider=${resolved.providerName} (${resolved.provider.kind})`);
    info(`  prompt  ${promptFile ? path.relative(PLATFORM_ROOT, promptFile) : '(无)'}`);
    info(`  request ${JSON.stringify(describe(request, resolved.provider), null, 2).split('\n').join('\n  ')}`);
  }
}

// ---------- archive ----------

function cmdArchiveVerify() {
  const { checked, problems } = verifyArchive();
  info(`已校验 ${checked} 份证据包`);
  if (problems.length) {
    for (const p of problems) info(`  x ${p}`);
    process.exit(1);
  }
  info('  ✓ 全部哈希一致');
}

function cmdArchiveIndex() {
  const rows = readIndex();
  if (!rows.length) return info('归档索引为空');
  info(`归档 ${rows.length} 条：`);
  for (const r of rows) {
    info(`  ${r.at}  ${r.project}/${r.requirement}/${r.task}  attempt-${r.attempt}  ${r.verdict}  ${r.files} files`);
  }
}

// ---------- dispatch ----------

const projectId = flags.project;
switch (command) {
  case 'projects': cmdProjects(); break;
  case 'doctor': cmdDoctor(projectId); break;
  case 'plan': cmdPlan(projectId); break;
  case 'new-task': cmdNew('task', projectId); break;
  case 'new-requirement': cmdNew('requirement', projectId); break;
  case 'prepare': if (!flags.task) fail('缺少 --task'); cmdPrepare(projectId); break;
  case 'run':
    if (flags.all) cmdRunAll(projectId);
    else { if (!flags.task) fail('缺少 --task 或 --all'); process.exit(cmdRun(projectId, flags.task)); }
    break;
  case 'agents': cmdAgents(projectId); break;
  case 'archive-index': cmdArchiveIndex(); break;
  case 'archive-verify': cmdArchiveVerify(); break;
  case undefined:
    info('命令：projects | doctor | plan | new-task | new-requirement | prepare | run | agents | archive-index | archive-verify');
    info(`模板：${listTemplates().join(', ')}`);
    break;
  default:
    fail(`未知命令 ${command}`);
}
