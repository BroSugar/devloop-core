import { Button } from '@devloop/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@devloop/ui';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

export function EvidenceView({ evidenceId, kind, sha, content, onBack }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-3.5" aria-hidden="true" />返回卡</Button>
          <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />证据 · {kind || 'evidence'}</h2>
        </div>
        <code className="max-w-[50%] truncate text-[11px] text-muted-foreground">{evidenceId}</code>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-xs">
            <span>sha256</span>
            <code className="text-[11px] font-normal text-muted-foreground">{sha || '(取自响应头)'}</code>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-[12px] leading-relaxed">
            {content}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
