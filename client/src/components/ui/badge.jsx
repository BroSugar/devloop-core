import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/40 bg-success/10 text-success',
        danger: 'border-danger/40 bg-danger/10 text-danger',
        info: 'border-primary/40 bg-primary/10 text-primary',
        warning: 'border-warning/40 bg-warning/10 text-warning',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({ className, tone, ...props }) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const TONE_BY_STATUS = {
  passed: 'success', accepted: 'success', ready: 'info', running: 'warning',
  failed: 'danger', blocked: 'neutral', pending: 'neutral', draft: 'neutral', archived: 'neutral',
  synced: 'success', db_ahead: 'warning', file_ahead: 'warning', conflict: 'danger',
  db_only: 'warning', file_only: 'warning', untracked: 'danger',
};

export function StatusBadge({ status, label, className }) {
  return (
    <Badge tone={TONE_BY_STATUS[status] || 'neutral'} className={className}>
      {label || status}
    </Badge>
  );
}
