// 流程视图：只渲染服务端给的坐标与状态，不做任何业务推导。
import { esc, statusClass } from '../web/dom.mjs';

export function renderFlow({ panel, project }) {
  const nodes = panel.flow.nodes || [];
  const edges = panel.flow.edges || [];
  if (!nodes.length) {
    return `<div class="empty">项目 ${esc(project.id)} 还没有需求卡</div>`;
  }
  const width = Math.max(...nodes.map((n) => n.x), 0) + 340;
  const height = Math.max(...nodes.map((n) => n.y), 0) + 140;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const paths = edges.map((e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) return '';
    const x1 = from.x + 156;
    const y1 = from.y + 20;
    const x2 = to.x;
    const y2 = to.y + 20;
    const mx = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" class="edge" />`;
  }).join('');

  const cards = nodes.map((n) => `
    <button class="node ${n.kind} ${statusClass(n.status)}"
      style="left:${n.x}px;top:${n.y}px"
      data-kind="${esc(n.kind)}"
      data-task="${esc(n.taskId || '')}"
      data-req="${esc(n.requirementId || '')}">
      <span class="node-label">${esc(n.label)}</span>
      <span class="${statusClass(n.status)}">${esc(n.status)}</span>
    </button>`).join('');

  return `<div class="flow" style="width:${width}px;height:${height}px">
    <svg class="flow-edges" width="${width}" height="${height}">${paths}</svg>
    ${cards}
  </div>`;
}
