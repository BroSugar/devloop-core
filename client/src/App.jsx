import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from './lib/api.js';
import { pickAdapter } from './lib/shell.js';
import { Button } from './components/ui/button.jsx';
import { Badge } from './components/ui/badge.jsx';
import { FloatingInput } from './components/floating-field.jsx';
import { FlowView } from './views/FlowView.jsx';
import { CardView } from './views/CardView.jsx';
import { EvidenceView } from './views/EvidenceView.jsx';
import { SyncView } from './views/SyncView.jsx';

const lines = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

export default function App() {
  const [caps, setCaps] = useState({ kind: 'unknown', available: [] });
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [panel, setPanel] = useState(null);
  const [sync, setSync] = useState(null);
  const [view, setView] = useState({ name: 'flow' });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [token, setTokenValue] = useState(getToken());
  const [card, setCard] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [hint, setHint] = useState('');

  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    (async () => {
      const adapter = await pickAdapter();
      setCaps(await adapter.capabilities());
      try {
        const list = (await api.projects()).data;
        setProjects(list);
        if (list.length) setProjectId(list[0].id);
        else setBanner('还没有接入任何项目：在 projects/ 下加 project.yaml 后重启服务端');
      } catch (e) {
        setBanner(`加载项目失败：${e.message}（检查访问令牌与服务端）`);
      }
    })();
  }, []);

  const refresh = useCallback(async (id) => {
    if (!id) return;
    try {
      const [p, s] = await Promise.all([api.panel(id), api.cardSync(id)]);
      setPanel(p.data);
      setSync(s.data);
      setBanner('');
    } catch (e) {
      setBanner(`加载面板失败：${e.message}`);
    }
  }, []);

  useEffect(() => { refresh(projectId); }, [projectId, refresh]);

  const openTask = useCallback(async (taskId) => {
    setBusy(true);
    setHint('');
    try {
      const task = (await api.task(taskId)).data;
      const requirement = (await api.requirement(task.requirementId)).data;
      const runs = (await api.runs(taskId)).data;
      const latest = runs[0];
      const evidenceList = latest ? (await api.evidence(latest.id)).data : [];
      setCard({ task, requirement, runs, run: latest, evidence: evidenceList });
      setView({ name: 'task', id: taskId });
    } catch (e) {
      setBanner(`加载任务失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const openEvidence = useCallback(async (evidenceId, kind) => {
    setBusy(true);
    try {
      const res = await api.evidenceContent(evidenceId);
      setEvidence({ id: evidenceId, kind, sha: res.etag, content: res.data });
      setView({ name: 'evidence', id: evidenceId });
    } catch (e) {
      setBanner(`加载证据失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const saveTask = useCallback(async (form) => {
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        autonomy: form.autonomy,
        objective: form.objective,
        deps: card.task.deps,
        scope: { write: lines(form.write), read: card.task.scope.read, deny: card.task.scope.deny },
        verify: lines(form.verify).map((ref) => ({ ref })),
        acceptance: lines(form.acceptance),
      };
      const res = await api.updateTask(card.task.id, payload, `"v${card.task.version}"`);
      setHint(`已保存 → v${res.data.version}`);
      await openTask(card.task.id);
    } catch (e) {
      setHint(e.code === 'conflict' ? '版本冲突：别人先改了，刷新后重试' : `保存失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [card, openTask]);

  const runTask = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.startRun(card.task.id, { actor: 'web' });
      setHint(`执行完成：${res.data.status}（${res.data.reason || '通过'}）`);
      await openTask(card.task.id);
      await refresh(projectId);
    } catch (e) {
      setHint(`执行失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [card, openTask, projectId, refresh]);

  const doSync = useCallback(async (dryRun, direction) => {
    setBusy(true);
    try {
      const fn = direction === 'export' ? api.exportCards : api.importCards;
      const res = await fn(projectId, { dryRun });
      setSyncResult(res.data);
      await refresh(projectId);
    } catch (e) {
      setBanner(`同步失败：${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh]);

  const conflicts = (sync?.summary?.conflict ?? 0) + (sync?.summary?.untracked ?? 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2">
        <div className="text-sm font-semibold">
          devloop <span className="text-[11px] font-normal text-muted-foreground">v1</span>
        </div>

        <select
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); setView({ name: 'flow' }); }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.stack}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <Badge tone="info">{caps.kind}</Badge>
          {['fs', 'term', 'agent'].map((c) => (
            <Badge key={c} tone={caps.available.includes(c) ? 'success' : 'neutral'}>{c}</Badge>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant={view.name === 'flow' ? 'subtle' : 'ghost'} size="sm" onClick={() => setView({ name: 'flow' })}>
            流程视图
          </Button>
          <Button variant={view.name === 'sync' ? 'subtle' : 'ghost'} size="sm" onClick={() => setView({ name: 'sync' })}>
            卡同步{conflicts > 0 ? ` ⚠${conflicts}` : ''}
          </Button>
          <div className="w-52">
            <FloatingInput
              label="访问令牌"
              value={token}
              onChange={(e) => setTokenValue(e.target.value)}
              onBlur={() => { if (token !== getToken()) { setToken(token); location.reload(); } }}
              className="h-11 pt-4"
            />
          </div>
        </div>
      </header>

      {banner ? (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">{banner}</div>
      ) : null}

      <main className="flex-1 overflow-auto p-4">
        {view.name === 'flow' && panel ? (
          <FlowView panel={panel} project={project} onOpenTask={openTask} />
        ) : null}

        {view.name === 'task' && card ? (
          <CardView
            task={card.task}
            requirement={card.requirement}
            runs={card.runs}
            run={card.run}
            evidence={card.evidence}
            busy={busy}
            hint={hint}
            onSave={saveTask}
            onRun={runTask}
            onOpenEvidence={openEvidence}
            onBack={() => setView({ name: 'flow' })}
          />
        ) : null}

        {view.name === 'evidence' && evidence ? (
          <EvidenceView {...evidence} onBack={() => setView({ name: 'task' })} />
        ) : null}

        {view.name === 'sync' && sync ? (
          <SyncView
            project={project ?? { name: '' }}
            report={sync}
            busy={busy}
            lastResult={syncResult}
            onExport={(dry) => doSync(dry, 'export')}
            onImport={(dry) => doSync(dry, 'import')}
            onBack={() => setView({ name: 'flow' })}
          />
        ) : null}

        {!panel && !banner ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
      </main>
    </div>
  );
}
