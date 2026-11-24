// 浮动标签表单件。规矩：标签在"聚焦或有值"时上浮，空且失焦时占位在字段中央。
// 用真实 <label htmlFor>，所以点标签也能聚焦；placeholder 只留空位，不显示文字。
import { useId, useState } from 'react';
import { Input } from './ui/input.jsx';
import { Textarea } from './ui/textarea.jsx';
import { cn } from '../lib/utils.js';

function FloatingLabel({ htmlFor, floated, centerClass, children }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'pointer-events-none absolute left-3 select-none transition-all duration-150',
        floated ? 'top-2 text-[11px] text-muted-foreground' : cn(centerClass, 'text-sm text-muted-foreground'),
      )}
    >
      {children}
    </label>
  );
}

export function FloatingInput({ label, value, onChange, hint, className, id, ...rest }) {
  const auto = useId();
  const fieldId = id || `in-${auto}`;
  const [focused, setFocused] = useState(false);
  const floated = focused || String(value ?? '').length > 0;

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={fieldId}
          value={value}
          onChange={onChange}
          placeholder=" "
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn('peer pt-5', className)}
          {...rest}
        />
        <FloatingLabel htmlFor={fieldId} floated={floated} centerClass="top-1/2 -translate-y-1/2">
          {label}
        </FloatingLabel>
      </div>
      {hint ? <p className="pl-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FloatingTextarea({ label, value, onChange, hint, rows = 6, className, id, ...rest }) {
  const auto = useId();
  const fieldId = id || `ta-${auto}`;
  const [focused, setFocused] = useState(false);
  const floated = focused || String(value ?? '').length > 0;

  return (
    <div className="space-y-1">
      <div className="relative">
        <Textarea
          id={fieldId}
          rows={rows}
          value={value}
          onChange={onChange}
          placeholder=" "
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn('peer', className)}
          {...rest}
        />
        <FloatingLabel htmlFor={fieldId} floated={floated} centerClass="top-6">
          {label}
        </FloatingLabel>
      </div>
      {hint ? <p className="pl-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FloatingSelect({ label, value, onChange, hint, children, className, id, ...rest }) {
  const auto = useId();
  const fieldId = id || `sel-${auto}`;
  const floated = String(value ?? '').length > 0;

  return (
    <div className="space-y-1">
      <div className="relative">
        <select
          id={fieldId}
          value={value}
          onChange={onChange}
          className={cn(
            'h-14 w-full appearance-none rounded-md border border-input bg-card px-3 pb-1 pt-5 text-sm text-foreground outline-none transition-colors',
            'focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-50',
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <FloatingLabel htmlFor={fieldId} floated={floated} centerClass="top-1/2 -translate-y-1/2">
          {label}
        </FloatingLabel>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">▾</span>
      </div>
      {hint ? <p className="pl-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
