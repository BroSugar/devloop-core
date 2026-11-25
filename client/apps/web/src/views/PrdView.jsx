import { useCallback, useEffect, useState } from 'react';
import { api } from '@devloop/api-client';
import { Button, Card, CardContent, CardHeader, CardTitle, StatusBadge, FloatingInput, FloatingTextarea } from '@devloop/ui';
import { FileText, Plus, RefreshCw, ShieldCheck } from 'lucide-react';

export function PrdView({ projectId }) {
  const [prds, setPrds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [form, setForm] = useState({ title: '', content: '' });
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const { data } = await api.prds(projectId);
      setPrds(data);
    } catch (e) {
      setHint(`加载失败：${e.message}`);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const open = useCallback(async (id) => {
    setBusy(true);
    setHint('');
    try {
      const { data } = await api.getPrd(id);
      setSelected(data);
      const r = await api.listPrdReviews(id);
      setReviews(r.data);
    } catch (e) {
      setHint(`加载失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    setHint('');
    try {
      await api.createPrd({ projectId, title: form.title, content: form.content });
      setForm({ title: '', content: '' });
      await load();
    } catch (e) {
      setHint(`创建失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [form, projectId, load]);

  const act = useCallback(async (fn, label) => {
    if (!selected) return;
    setBusy(true);
    setHint('');
    try {
      await fn(selected.id);
      await open(selected.id);
      await load();
      setHint(`已${label}`);
    } catch (e) {
      setHint(`${label}失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [selected, open, load]);

  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>新建 PRD</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FloatingInput label="标题" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <FloatingTextarea label="正文" value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={6} />
            <Button size="sm" disabled={busy || !form.title.trim()} onClick={create}><Plus className="size-3.5" aria-hidden="true" />新建</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>PRD 列表</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {prds.length ? prds.map((p) => (
              <button key={p.id} type="button" onClick={() => open(p.id)} data-testid="prd-item"
                className="flex w-full items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-left text-xs hover:bg-muted/40">
                <span className="truncate font-medium">{p.title}</span>
                <StatusBadge status={p.status} />
              </button>
            )) : <p className="py-6 text-center text-xs text-muted-foreground" data-testid="prd-empty">还没有 PRD</p>}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <StatusBadge status={selected.status} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy || !['draft', 'needs_revision'].includes(selected.status)} onClick={() => act(api.refinePrd, '完善')}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />完善
                </Button>
                <Button size="sm" disabled={busy || selected.status !== 'reviewing'} onClick={() => act(api.reviewPrd, '审核')}>
                  <ShieldCheck className="size-3.5" aria-hidden="true" />审核
                </Button>
              </div>
            </div>

            {hint ? <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{hint}</div> : null}

            <Card>
              <CardHeader><CardTitle>正文</CardTitle></CardHeader>
              <CardContent><pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{selected.content}</pre></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>审核记录（{reviews.length}）</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {reviews.length ? reviews.map((r) => (
                  <div key={r.id} className="rounded border border-border px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.kind === 'refine' ? '完善' : '审核'}</span>
                      <span className="flex items-center gap-2">
                        {r.verdict ? <span className="text-muted-foreground">{r.verdict}</span> : null}
                        <StatusBadge status={r.status} />
                      </span>
                    </div>
                    {r.findings?.length ? (
                      <ul className="mt-1 space-y-1">
                        {r.findings.map((f, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground">#{f.item} [{f.severity}] {f.problem} → {f.requiredFix}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )) : <p className="text-xs text-muted-foreground">还没有记录</p>}
              </CardContent>
            </Card>
          </>
        ) : <p className="text-sm text-muted-foreground">选择左侧 PRD 查看详情</p>}
      </div>
    </div>
  );
}
