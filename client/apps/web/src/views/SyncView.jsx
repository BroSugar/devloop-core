import { Button } from '@devloop/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@devloop/ui';
import { StatusBadge } from '@devloop/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@devloop/ui';
import { ArrowLeft, Eye, FileUp, FileDown, Inbox } from 'lucide-react';

const STATE_LABEL = {
  synced: '已同步', db_ahead: 'DB 有改动', file_ahead: '仓库有改动', conflict: '冲突',
  db_only: '仅 DB', file_only: '仅文件', untracked: '无基线',
};
const ACTION_LABEL = { export: '可导出', import: '可导入', manual: '需人工', none: '—' };
const short = (v) => (v ? `${String(v).slice(0, 8)}…` : '—');

export function SyncView({ project, report, busy, lastResult, onExport, onImport, onBack }) {
  const items = report?.items ?? [];
  const counts = report?.summary ?? {};
  const conflicts = (counts.conflict ?? 0) + (counts.untracked ?? 0);
  const exportable = items.filter((i) => i.action === 'export').length;
  const importable = items.filter((i) => i.action === 'import').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-3.5" aria-hidden="true" />返回流程</Button>
          <h2 className="mt-2 text-lg font-semibold">卡同步 · {project.name}</h2>
          <p className="text-xs text-muted-foreground">
            DB 有改动 {exportable} 张 · 仓库有改动 {importable} 张 · 冲突 {conflicts} 张
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onExport(true)}><Eye className="size-3.5" aria-hidden="true" />预览导出</Button>
          <Button size="sm" disabled={busy} onClick={() => onExport(false)}><FileUp className="size-3.5" aria-hidden="true" />导出到仓库</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onImport(true)}><Eye className="size-3.5" aria-hidden="true" />预览导入</Button>
          <Button variant="subtle" size="sm" disabled={busy} onClick={() => onImport(false)}><FileDown className="size-3.5" aria-hidden="true" />从仓库导入</Button>
        </div>
      </div>

      {lastResult ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          {lastResult.dryRun ? '预览' : '已执行'}：
          {Object.entries(lastResult.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-xs text-muted-foreground">
            导出会重写卡文件（不保留 YAML 注释）；冲突与「仓库有改动」的卡不会被覆盖
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类型</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>动作</TableHead>
                <TableHead>路径</TableHead>
                <TableHead>DB 哈希</TableHead>
                <TableHead>文件哈希</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length ? items.map((i) => (
                <TableRow key={`${i.kind}:${i.id}`}>
                  <TableCell className="text-xs">{i.kind === 'requirement' ? '需求' : '任务'}</TableCell>
                  <TableCell className="text-xs"><code>{i.id}</code></TableCell>
                  <TableCell><StatusBadge status={i.state} data-testid="sync-state" label={STATE_LABEL[i.state] || i.state} /></TableCell>
                  <TableCell className="text-xs">{ACTION_LABEL[i.action] || i.action}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{i.path}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{short(i.dbSha)}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{short(i.fileSha)}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground"><Inbox className="mx-auto mb-2 size-6 opacity-50" aria-hidden="true" />没有卡</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
