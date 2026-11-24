// 卡视图：展示 + 编辑（唯一允许客户端写的数据）。
// 保存必须带上服务端给的 ETag，冲突时提示重新拉取。
import { esc, statusClass } from '../web/dom.mjs';

export function renderCard({ task, requirement, runs, run, evidence, canExecute, canUseLocalAgent }) {
  const stages = run?.stages?.length
    ? `<table class="table"><thead><tr><th>#</th><th>门禁</th><th>命令</th><th>退出码</th><th>耗时</th></tr></thead><tbody>
        ${run.stages.map((s) => `<tr class="${s.exitCode === 0 ? '' : 'row-fail'}">
          <td>${s.seq}</td><td>${esc(s.name)}</td><td><code>${esc(s.command)}</code></td>
          <td>${s.exitCode ?? '-'}</td><td>${s.durationMs ?? '-'}ms</td></tr>`).join('')}
      </tbody></table>`
    : '<div class="muted">还没有执行记录</div>';

  const evidenceRows = evidence?.length
    ? `<ul class="evidence">${evidence.map((e) => `<li>
        <button class="link" data-evidence="${esc(e.id)}">${esc(e.kind)}</button>
        <code class="sha">${esc(e.sha256.slice(0, 12))}…</code>
        <span class="muted">${e.bytes} B</span></li>`).join('')}</ul>`
    : '<div class="muted">没有证据</div>';

  const runRows = runs?.length
    ? `<ul class="runs">${runs.map((r) => `<li>
        <span class="${statusClass(r.status)}">${esc(r.status)}</span>
        <code>${esc(r.id)}</code>
        <span class="muted">attempt ${r.attempt} · ${esc(r.reason || '')}</span></li>`).join('')}</ul>`
    : '<div class="muted">无</div>';

  return `
    <div class="panel-head">
      <div>
        <h2>${esc(task.id)} · ${esc(task.title)}</h2>
        <div class="muted">需求 ${esc(requirement.id)} · 自治等级 ${esc(task.autonomy)} · 版本 v${task.version}</div>
      </div>
      <div class="actions">
        ${canExecute ? `<button class="primary" data-action="run" data-task="${esc(task.id)}">运行（服务端执行）</button>` : ''}
        ${canUseLocalAgent ? '<button data-action="local-agent">用本地 agent 生成</button>' : '<button disabled title="Web 形态无本地 agent 能力">用本地 agent 生成</button>'}
      </div>
    </div>

    <div class="grid2">
      <section>
        <h3>写域（scope.write）</h3>
        <ul class="mono">${(task.scope.write || []).map((w) => `<li>${esc(w)}</li>`).join('') || '<li class="muted">空</li>'}</ul>
        <h3>禁改（scope.deny）</h3>
        <ul class="mono">${(task.scope.deny || []).map((w) => `<li>${esc(w)}</li>`).join('') || '<li class="muted">空</li>'}</ul>
        <h3>验收标准</h3>
        <ul class="mono">${(task.acceptance || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        <h3>门禁</h3>
        <ul class="mono">${(task.verify || []).map((v) => `<li>${esc(v.ref)}${v.resolvedCommand ? ` → <code>${esc(v.resolvedCommand)}</code>` : ''}</li>`).join('')}</ul>
      </section>

      <section>
        <h3>任务目标（可编辑）</h3>
        <textarea id="objective" rows="10">${esc(task.objective || '')}</textarea>
        <div class="row">
          <button data-action="save" data-task="${esc(task.id)}">保存（If-Match: v${task.version}）</button>
          <span id="save-hint" class="muted"></span>
        </div>
      </section>
    </div>

    <h3>最近一次执行</h3>
    ${stages}
    <h3>执行历史</h3>
    ${runRows}
    <h3>证据链（可追溯 diff 与 verify 输出）</h3>
    ${evidenceRows}`;
}
