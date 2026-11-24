import { cn } from '../../lib/utils.js';

export function Table({ className, ...props }) {
  return (
    <div className="w-full overflow-auto rounded-lg border border-border">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-border', className)} {...props} />;
}

export function TableBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }) {
  return <tr className={cn('border-b border-border transition-colors hover:bg-muted/40', className)} {...props} />;
}

export function TableHead({ className, ...props }) {
  return <th className={cn('px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground', className)} {...props} />;
}

export function TableCell({ className, ...props }) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />;
}
