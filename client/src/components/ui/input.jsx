import { cn } from '../../lib/utils.js';

/** 基础输入框。浮动标签由 FloatingField 负责，这里只管外观。 */
export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'flex h-14 w-full rounded-md border border-input bg-card px-3 py-4 text-sm text-foreground outline-none transition-colors',
        'placeholder:text-transparent focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
