// Web 单页壳：只做编排（取数、路由、事件委托），业务状态一律来自服务端。

import { createApiClient } from './api.mjs';
import { esc, statusClass } from './dom.mjs';
import { pickAdapter } from '../shell/adapter.mjs';
import { renderFlow } from '../views/flow.mjs';
import { renderCard } from '../views/card.mjs';
import { renderEvidence } from '../views/evidence.mjs';

const state = {
  token: localStorage.getItem('devloop.token') || 'dev-local-token',
  api: null,
  adapter: null,
  caps: { kind: 'unknown', available: [] },
  projects: [],
  project: null,
  panel: null,
  agentConfig: null,
};

const $ = (id) => document.getElementById(id);

function banner(message) {
  const el = $('banner');
  el.textContent = message;
  el.hidden = !message;
}

async function boot() {
  state.adapter = await pickAdapter();
  state.caps = await state.adapter.capabilities();
  state.api = createApiClient({ token: state.token });

  try {
    state.projects = (await state.api.projects()).data;
  } catch (e) {
    banner(`加载项目失败：${e.message}（检查 token 与服务端是否启动）`);
    return;
  }
  if (!state.projects.length) {
    banner('还没有接入任何项目：在 projects/ 下加 project.yaml 后重启服务端');
    return;
  }

  state.project = state.projects[0];
  renderChrome();
  await refresh();
  window.addEventListener('hashchange', () => route());
  $('view').addEventListener('click', onClick);
  route();
}

function renderChrome() {
  $('caps').innerHTML = `<span class="chip">${esc(state.caps.kind)}</span>`
    + ['fs', 'term', 'agent'].map((c) => `<span class="chip ${state.caps.available.includes(c) ? 'on' : 'off'}">${c}</span>`).join('');
  const sel = $('project');
  sel.innerHTML = state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.stack)}</option>`).join('');
  sel.value = state.project.id;
  sel.onchange = async () => {
    state.project = state.projects.find((p) => p.id === sel.value);
    await refresh();
    location.hash = '';
    route();
  };
  $('token').value = state.token;
  $('token').onchange = (e) => {
    state.token = e.target.value.trim();
    localStorage.setItem('devloop.token', state.token);
    location.reload();
  };
}

async function refresh() {
  try {
    state.panel = (await state.api.panel(state.project.id)).data;
    state.agentConfig = (await state.api.agentConfig(state.project.id)).data;
    banner('');
  } catch (e) {
    banner(`加载面板失败：${e.message}`);
  }
}

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (hash.startsWith('/task/')) return renderTaskView(decodeURIComponent(hash.slice('/task/'.length)));
  if (hash.startsWith('/evidence/')) return renderEvidenceView(decodeURIComponent(hash.slice('/evidence/'.length)));
  $('view').innerHTML = `
    <section class="flow-wrap">
      <div class="panel-head">
        <div>
          <h2>${esc(state.project.name)}</h2>
          <div class="muted">${esc(state.project.id)} · ${esc(state.project.stack)} · ${state.panel.requirements.length} 个需求</div>
        </div>
        <div class="actions"><button class="link" data-action="reload">刷新</button></div>
      </div>
      ${renderFlow({ panel: state.panel, project: state.project })}
    </section>`;
}

async function renderTaskView(taskId) {
  try {
    const task = (await state.api.task(taskId)).data;
    const requirement = (await state.api.requirement(task.requirementId)).data;
    const runs = (await state.api.runs(taskId)).data;
    const latest = runs[0];
    const evidence = latest ? (await state.api.evidence(latest.id)).data : [];
    $('view').innerHTML = renderCard({
      task, requirement, runs, run: latest, evidence,
      canExecute: task.autonomy !== 'human-only',
      canUseLocalAgent: state.caps.available.includes('agent'),
    });
  } catch (e) {
    banner(`加载任务失败：${e.message}`);
  }
}

async function renderEvidenceView(evidenceId) {
  try {
    const content = (await state.api.evidenceContent(evidenceId)).data;
    const runId = evidenceId.split('_')[1] && evidenceId.match(/^ev_(run_[^_]+_\d+)_/)?.[1];
    const evidence = { id: evidenceId, kind: evidenceId.split('_')[2] || 'evidence', sha256: '(见响应头)', bytes: content.length };
    $('view').innerHTML = renderEvidence({ evidence, content });
    void runId;
  } catch (e) {
    banner(`加载证据失败：${e.message}`);
  }
}

async function onClick(event) {
  const node = event.target.closest('[data-task]');
  if (node && node.dataset.kind === 'task') {
    location.hash = `#/task/${encodeURIComponent(node.dataset.task)}`;
    return;
  }
  const evidenceBtn = event.target.closest('[data-evidence]');
  if (evidenceBtn) {
    location.hash = `#/evidence/${encodeURIComponent(evidenceBtn.dataset.evidence)}`;
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'reload') {
    await refresh();
    await route();
    return;
  }
  if (action === 'back') {
    history.back();
    return;
  }
  if (action === 'run') {
    const taskId = event.target.closest('[data-task]').dataset.task;
    banner(`已提交 ${taskId} 执行，等待服务端返回…`);
    try {
      const res = await state.api.startRun(taskId, { actor: 'web' });
      banner(`执行完成：${res.data.status}（${res.data.reason || '通过'}）`);
    } catch (e) {
      banner(`执行失败：${e.message}`);
    }
    await refresh();
    await renderTaskView(taskId);
    return;
  }
  if (action === 'save') {
    const taskId = event.target.closest('[data-task]').dataset.task;
    const hint = $('save-hint');
    try {
      const task = (await state.api.task(taskId)).data;
      const objective = $('objective').value;
      const updated = await state.api.updateTask(taskId, {
        title: task.title,
        autonomy: task.autonomy,
        objective,
        deps: task.deps,
        scope: task.scope,
        verify: task.verify.map((v) => ({ ref: v.ref })),
        acceptance: task.acceptance,
      }, (await state.api.task(taskId)).etag || `"v${task.version}"`);
      hint.textContent = `已保存 → v${updated.data.version}`;
      await renderTaskView(taskId);
    } catch (e) {
      hint.textContent = e.code === 'conflict' ? '版本冲突：别人先改了，请刷新后重试' : `保存失败：${e.message}`;
    }
    return;
  }
  if (action === 'local-agent') {
    banner('本地 agent 能力在桌面壳中提供（Web 形态不支持）');
  }
}

boot();
