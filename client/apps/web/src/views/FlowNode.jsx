import { Handle, Position } from '@xyflow/react';
import { StatusBadge, TONE_BY_STATUS, TONE_STROKE, cn } from '@devloop/ui';
import { ListChecks, SquareCheckBig } from 'lucide-react';

const NODE_W = 168;
const NODE_H = 64;

// React Flow 自定义节点：卡片 + kind 图标 + 状态徽章 + 状态色左边条。
// 保留 data-testid，供 tools/visual/check.mjs 定位与点击；Handle 提供边的连接点。
export function FlowNode({ data }) {
  const { kind, label, status, taskId, onOpenTask } = data;
  const tone = TONE_BY_STATUS[status] || 'neutral';
  const accent = TONE_STROKE[tone];
  const isTask = kind === 'task';
  const Icon = isTask ? SquareCheckBig : ListChecks;

  return (
    <div
      data-testid={isTask ? 'task-node' : 'req-node'}
      onClick={() => isTask && taskId && onOpenTask(taskId)}
      style={{ width: NODE_W, height: NODE_H, borderLeftColor: accent }}
      className={cn(
        'flex flex-col justify-between rounded-lg border border-l-4 bg-card p-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        isTask ? 'cursor-pointer hover:border-primary' : 'cursor-default',
      )}
    >
      <Handle type="target" position={Position.Left} style={{ width: 6, height: 6, background: accent, border: 'none' }} />
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-xs" title={label}>{label}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={status} />
      </div>
      <Handle type="source" position={Position.Right} style={{ width: 6, height: 6, background: accent, border: 'none' }} />
    </div>
  );
}
