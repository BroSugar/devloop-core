// 卡同步视图：展示 DB / 文件 / 基线的三方状态，并提供显式导出与导入。
// 客户端不做冲突判定——所有 state 与 action 都来自服务端。
import { esc, statusClass } from '../web/dom.mjs';

const STATE_LABEL = {
  synced: '已同步',
  db_ahead: 'DB 有改动',
  file_ahead: '仓库有改动',
  conflict: '冲突',
  db_only: '仅 DB',
  file_only: '仅文件',
  untracked: '无基线',
};

const ACTION_LABEL = { export: '可导出', import: '可导入', manual: '需人工', none: '—' };

function sha(v) {
  return v ? `${String(v).slice(0, 8)}…` : '—';
}

export function renderSync({ project, report, lastResult }) {
  const items = report?.items || [];
  const counts = report?.summary || {};
  const conflicts = (counts.conflict || 0) + (counts.untracked || 0);
  const exportable = items.filter((i) => i.action === 'export').length;
  const importable = items.filter((i) => i.action === 'import').length;

  const rows = items.map((i) => {
    const cls = i.state === 'synced' ? 'ok' : i.state === 'conflict' || i.state === 'untracked' ? 'fail' : 'running';
    return `<tr>
      <td>${i.kind === 'requirement' ? '需求' : '任务'}</td>
      <td><code>${esc(i.id)}</code></td>
      <td><span class="badge ${cls}">${esc(STATE_LABEL[i.state] || i.state)}</span></td>
      <td>${esc(ACTION_LABEL[i.action] || i.action)}</td>
      <td class="mono-cell">${esc(i.path)}</td>
      <td class="sha">${sha(i.dbSha)}</td>
      <td class="sha">${sha(i.fileSha)}</td>
    </tr>`;
  }).join('');

  const result = lastResult
    ? `<div class="banner-inline">${lastResult.dryRun ? '预览' : '已执行'}：${Object.entries(lastResult.counts || {}).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</div>`
    : '';

  return `
    <div class="panel-head">
      <div>
        <h2>卡同步 · ${esc(project.name)}</h2>
        <div class="muted">
          DB 有改动 ${exportable} 张 · 仓库有改动 ${importable} 张 · 冲突 ${conflicts} 张
        </div>
      </div>
      <div class="actions">
        <button data-action="open-flow">← 流程视图</button>
        <button data-action="sync-export" data-dry="1">预览导出</button>
        <button class="primary" data-action="sync-export">导出到仓库</button>
        <button data-action="sync-import" data-dry="1">预览导入</button>
        <button data-action="sync-import">从仓库导入</button>
      </div>
    </div>
    ${result}
    <div class="muted" style="margin:8px 0 12px">
      导出会重写卡文件（不保留 YAML 注释）；冲突与“仓库有改动”的卡不会被覆盖。
    </div>
    <table class="table">
      <thead><tr><th>类型</th><th>ID</th><th>状态</th><th>动作</th><th>路径</th><th>DB 哈希</th><th>文件哈希</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">没有卡</td></tr>'}</tbody>
    </table>`;
}
