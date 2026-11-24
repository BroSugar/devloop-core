import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
        subtle: 'bg-muted text-foreground hover:brightness-110',
        danger: 'bg-danger text-white hover:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4',
        lg: 'h-10 px-5',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({ className, variant, size, ...props }) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
