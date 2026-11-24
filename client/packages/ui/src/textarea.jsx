import { cn } from './utils.js';

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        'flex w-full rounded-md border border-input bg-card px-3 pb-3 pt-6 text-sm text-foreground outline-none transition-colors',
        'placeholder:text-transparent focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
