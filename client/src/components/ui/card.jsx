import { cn } from '../../lib/utils.js';

export function Card({ className, ...props }) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground', className)} {...props} />;
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1 border-b border-border px-4 py-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-sm font-semibold', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-4 py-3', className)} {...props} />;
}
