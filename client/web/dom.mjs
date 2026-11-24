// 视图层唯一允许的 DOM 工具。视图不得直接触碰 window/fetch/宿主 API。

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function statusClass(status) {
  const map = {
    passed: 'ok', accepted: 'ok', ready: 'ready', running: 'running',
    failed: 'fail', blocked: 'blocked', pending: 'idle', draft: 'idle', archived: 'idle',
  };
  return `badge ${map[status] || 'idle'}`;
}

export function mount(root, html) {
  root.innerHTML = html;
  return root;
}
