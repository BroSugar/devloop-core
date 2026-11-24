// shadcn 风格组件库的唯一出口。视图只从这里取件，不直接引具体文件，
// 这样以后换基础件实现（或整体替换成别的设计体系）只改这一处。
export { cn } from './utils.js';

export { Button, buttonVariants } from './button.jsx';
export { Input } from './input.jsx';
export { Textarea } from './textarea.jsx';
export { Label } from './label.jsx';
export { Badge, StatusBadge, TONE_BY_STATUS, TONE_STROKE } from './badge.jsx';
export { Card, CardHeader, CardTitle, CardContent } from './card.jsx';
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table.jsx';
export { FloatingInput, FloatingTextarea, FloatingSelect } from './floating-field.jsx';
