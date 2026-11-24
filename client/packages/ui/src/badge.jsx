import { cva } from 'class-variance-authority';
import { cn } from './utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/40 bg-success/10 text-success',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        info: 'border-info/40 bg-info/10 text-info',
        warning: 'border-warning/40 bg-warning/10 text-warning',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({ className, tone, ...props }) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// 状态 → tone 的唯一映射；流程视图节点/连线与徽章共用，保证颜色一致
export const TONE_BY_STATUS = {
  passed: 'success', accepted: 'success', ready: 'info', running: 'warning',
  failed: 'danger', blocked: 'neutral', pending: 'neutral', draft: 'neutral', archived: 'neutral',
  synced: 'success', db_ahead: 'warning', file_ahead: 'warning', conflict: 'danger',
  db_only: 'warning', file_only: 'warning', untracked: 'danger',
};

// tone → SVG 描边色（CSS 变量），供连线/节点 accent 复用
export const TONE_STROKE = {
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  neutral: 'var(--color-border)',
};

export function StatusBadge({ status, label, className, ...props }) {
  return (
    <Badge tone={TONE_BY_STATUS[status] || 'neutral'} className={cn('gap-1.5', className)} {...props}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {label || status}
    </Badge>
  );
}
