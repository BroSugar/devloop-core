import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TONE_BY_STATUS, TONE_STROKE } from '@devloop/ui';
import { FlowNode } from './FlowNode.jsx';

const nodeTypes = { devloop: FlowNode };

// 状态 → 连线描边色（与 StatusBadge/节点 accent 同源）
function statusStroke(status) {
  return TONE_STROKE[TONE_BY_STATUS[status] || 'neutral'];
}

export function FlowView({ panel, project, onOpenTask }) {
  const nodes = panel?.flow?.nodes ?? [];
  const edges = panel?.flow?.edges ?? [];

  const rfNodes = useMemo(() => nodes.map((n) => ({
    id: n.id,
    type: 'devloop',
    position: { x: n.x, y: n.y },
    data: { ...n, onOpenTask },
  })), [nodes, onOpenTask]);

  // 两通道：方向 = animated 流动虚线 + markerEnd 箭头；状态 = 颜色（源节点状态）
  const rfEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges.map((e) => {
      const source = byId.get(e.from);
      const color = source ? statusStroke(source.status) : 'var(--color-border)';
      return {
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color },
      };
    });
  }, [nodes, edges]);

  if (!nodes.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        项目 {project.id} 还没有需求卡
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-8rem)] w-full overflow-hidden rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant="dots" gap={20} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
