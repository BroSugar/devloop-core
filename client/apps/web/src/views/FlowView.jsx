import { StatusBadge } from '@devloop/ui';
import { cn } from '@devloop/ui';

const NODE_W = 168;
const NODE_H = 64;

export function FlowView({ panel, project, onOpenTask }) {
  const nodes = panel?.flow?.nodes ?? [];
  const edges = panel?.flow?.edges ?? [];

  if (!nodes.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        项目 {project.id} 还没有需求卡
      </div>
    );
  }

  const width = Math.max(...nodes.map((n) => n.x)) + 320;
  const height = Math.max(...nodes.map((n) => n.y)) + 140;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="relative" style={{ width, height }}>
      <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
        {edges.map((edge, i) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${edge.from}-${edge.to}-${i}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="currentColor"
              className="text-border"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>

      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={() => node.taskId && onOpenTask(node.taskId)}
          style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
          className={cn(
            'absolute flex flex-col justify-between rounded-lg border bg-card p-2.5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            node.kind === 'task' ? 'border-border hover:border-primary' : 'border-primary/40 bg-primary/5',
          )}
        >
          <span className="truncate text-xs" title={node.label}>
            {node.label}
          </span>
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={node.status} />
            {node.kind === 'task' ? (
              <span className="text-[10px] text-muted-foreground">{node.taskId}</span>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
}
