import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@devloop/ui';
import { Button } from '@devloop/ui';
import { StatusBadge } from '@devloop/ui';
import { FloatingInput, FloatingSelect, FloatingTextarea } from '@devloop/ui';

const toLines = (list) => (list ?? []).join('\n');
const fromLines = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

// 门禁阶段名对用户友好化；历史数据里残留的 cmdN 内部命名也在这里兜住
const STAGE_LABEL = { build: '构建', lint: '静态检查', test: '测试', custom: '自定义命令' };
const stageLabel = (name) => STAGE_LABEL[name] || (/^cmd\d+$/.test(name) ? '自定义命令' : name);

function initial(task) {
  return {
    title: task.title,
    autonomy: task.autonomy,
    objective: task.objective ?? '',
    write: toLines(task.scope?.write),
    verify: toLines((task.verify ?? []).map((v) => v.ref)),
    acceptance: toLines(task.acceptance),
  };
}

export function CardView({ task, requirement, runs, run, evidence, busy, hint, onSave, onRun, onOpenEvidence, onBack }) {
  const [form, setForm] = useState(() => initial(task));
  useEffect(() => setForm(initial(task)), [task.id, task.version]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial(task));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>← 返回流程</Button>
            <StatusBadge status={task.status} />
            <span className="text-xs text-muted-foreground">v{task.version} · {requirement.id} · {task.id}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold">{task.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || task.autonomy === 'human-only'}
            title={task.autonomy === 'human-only' ? '自治等级为 human-only，必须人工执行' : ''}
            onClick={onRun}
          >
            运行（服务端执行）
          </Button>
          <Button size="sm" disabled={busy || !dirty} onClick={() => onSave(form)}>
            {dirty ? '保存修改' : '无改动'}
          </Button>
        </div>
      </div>

      {hint ? <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">{hint}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>卡内容（可编辑）</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <FloatingInput label="标题" value={form.title} onChange={set('title')} />
            <FloatingSelect label="自治等级" value={form.autonomy} onChange={set('autonomy')}
              hint="human-only 的任务无法通过 API 触发执行">
              <option value="auto">auto · 可全自动</option>
              <option value="assisted">assisted · 生成后人工确认</option>
              <option value="human-only">human-only · 必须人工</option>
            </FloatingSelect>
            <FloatingTextarea label="任务目标" value={form.objective} onChange={set('objective')} rows={7} />
            <FloatingTextarea label="写域 scope.write（每行一条）" value={form.write} onChange={set('write')} rows={3}
              hint="提交时按 git diff 逐文件校验，越界即失败" />
            <FloatingTextarea label="门禁 verify（每行一条）" value={form.verify} onChange={set('verify')} rows={3}
              hint="门禁名（build/lint/test）或裸命令" />
            <FloatingTextarea label="验收标准（每行一个 AC id）" value={form.acceptance} onChange={set('acceptance')} rows={2} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>最近一次执行</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {run ? (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    <StatusBadge status={run.status} />
                    <code className="text-muted-foreground">{run.id}</code>
                  </div>
                  <div className="text-xs text-muted-foreground">{run.reason || '通过'}</div>
                  {run.stages?.length ? (
                    <ul className="space-y-1 text-xs">
                      {run.stages.map((s) => (
                        <li key={s.seq} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                          <span>{stageLabel(s.name)}</span>
                          <code className="text-[11px] text-muted-foreground">{s.command}</code>
                          <span className={s.exitCode === 0 ? 'text-success' : 'text-danger'}>{s.exitCode ?? '-'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : <p className="text-xs text-muted-foreground">还没有执行记录</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>证据链（{evidence?.length ?? 0}）</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {evidence?.length ? evidence.map((e) => (
                <button key={e.id} type="button" data-testid="evidence-item" data-kind={e.kind}
                  onClick={() => onOpenEvidence(e.id, e.kind)}
                  className="flex w-full items-center justify-between gap-2 rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted/40">
                  <span>{e.kind}</span>
                  <code className="text-[11px] text-muted-foreground">{e.sha256.slice(0, 12)}…</code>
                  <span className="text-muted-foreground">{e.bytes} B</span>
                </button>
              )) : <p className="text-xs text-muted-foreground">没有证据</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>执行历史</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {runs?.length ? runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <StatusBadge status={r.status} />
                  <code className="text-[11px] text-muted-foreground">{r.id}</code>
                  <span className="text-muted-foreground">attempt {r.attempt}</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">无</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
