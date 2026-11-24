import { cn } from './utils.js';

export function Label({ className, ...props }) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
}
