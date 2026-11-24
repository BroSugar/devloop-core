// 卡校验（服务端）：需求卡 + 任务卡 → 合法 DAG。
// 从平台的 plan.mjs 抽出，差异是数据源换成数据库，且返回结构化结果给 API。

import fs from 'node:fs';
import path from 'node:path';
import { matchesAny, mayOverlap, staticPrefix } from '../../platform/lib/policy.mjs';

export function validateCards({ requirement, tasks, project, config, dag }) {
  const errors = [];
  const warnings = [];
  const repo = project.repoPath;
  const acIds = new Set((requirement?.acceptance || []).map((a) => a.id));

  if (!requirement) errors.push('需求不存在');
  else if (requirement.status !== 'ready') {
    warnings.push(`需求状态为 ${requirement.status}，只有 ready 才应进入执行队列`);
  }

  for (const ac of requirement?.acceptance || []) {
    const target = String(ac.verifyBy || '').replace(/\\/g, '/');
    if (!target) { errors.push(`${ac.id}: 缺少 verifyBy`); continue; }
    if (!fs.existsSync(path.join(repo, target))) {
      errors.push(`${ac.id}: 验收测试文件在仓库中不存在 → ${target}`);
    }
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    if (!task.verify?.length) errors.push(`${task.id}: 至少需要一条 verify`);
    if (!task.scope?.write?.length) errors.push(`${task.id}: scope.write 不能为空`);
    for (const dep of task.deps) if (!byId.has(dep)) errors.push(`${task.id}: 依赖不存在 ${dep}`);
    for (const ac of task.acceptance) if (!acIds.has(ac)) errors.push(`${task.id}: 引用了不存在的验收标准 ${ac}`);

    for (const glob of task.scope.write) {
      if (!/[*?]/.test(glob)) {
        const abs = path.join(repo, glob);
        if (fs.existsSync(abs)) continue;
        if (fs.existsSync(path.dirname(abs))) { warnings.push(`${task.id}: ${glob} 为新建文件（父目录存在）`); continue; }
        errors.push(`${task.id}: 写域 ${glob} 落不到磁盘（父目录不存在）`);
      } else {
        const prefix = staticPrefix(glob);
        if (prefix && !fs.existsSync(path.join(repo, prefix))) {
          errors.push(`${task.id}: 写域 ${glob} 的静态前缀 ${prefix} 不存在`);
        }
      }
    }
  }

  if (dag && !dag.validated) errors.push('DAG 存在环或不可达任务');

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      for (const wa of a.scope.write) {
        for (const wb of b.scope.write) {
          if (!mayOverlap(wa, wb)) continue;
          const serialized = a.deps.includes(b.id) || b.deps.includes(a.id);
          if (serialized) warnings.push(`${a.id} 与 ${b.id} 写域重叠但已串行`);
          else errors.push(`${a.id} 与 ${b.id} 写域重叠且无依赖：${wa} ~ ${wb}`);
        }
      }
    }
  }

  const deny = config?.policy?.denyWrite || [];
  for (const task of tasks) {
    for (const glob of task.scope.write) {
      const hits = deny.filter((d) => {
        if (!/[*?]/.test(glob)) return matchesAny(glob, [d]);
        const p = staticPrefix(glob);
        const dp = staticPrefix(d);
        return !!p && !!dp && (p === dp || p.startsWith(`${dp}/`) || dp.startsWith(`${p}/`));
      });
      if (hits.length) warnings.push(`${task.id}: 写域 ${glob} 命中禁改规则 ${hits.join(', ')}，执行期按 diff 拦截`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
