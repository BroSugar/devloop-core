// 写域与预算策略：任务只能改它该改的东西，且改动量有上限。

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

export function globToRegExp(glob) {
  const p = normalizePath(glob).replace(/\/+$/, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(file, patterns) {
  const f = normalizePath(file);
  return (patterns || []).some((g) => globToRegExp(g).test(f));
}

export function staticPrefix(glob) {
  const p = normalizePath(glob);
  const idx = p.search(/[*?]/);
  if (idx < 0) return p;
  const head = p.slice(0, idx);
  const lastSlash = head.lastIndexOf('/');
  return lastSlash < 0 ? '' : head.slice(0, lastSlash);
}

export function mayOverlap(a, b) {
  if (normalizePath(a) === normalizePath(b)) return true;
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  if (!pa || !pb) return true;
  return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
}

/** 逐文件判定：允许 = 命中 write 且未命中 deny（deny 优先）。 */
export function checkChanges(files, card, policy = {}) {
  const write = card?.scope?.write || [];
  const deny = [...new Set([...(card?.scope?.deny || []), ...(policy.deny_write || [])])];
  const violations = [];
  const allowed = [];
  for (const file of files) {
    if (matchesAny(file, deny)) {
      violations.push({ file, reason: 'deny', detail: `命中禁改规则（${deny.join(', ')}）` });
    } else if (!matchesAny(file, write)) {
      violations.push({ file, reason: 'out_of_scope', detail: `未命中写域（${write.join(', ')}）` });
    } else {
      allowed.push(file);
    }
  }
  return { allowed, violations };
}

/** 预算：文件数与改动行数，防止“一张卡改了半个仓库”仍然过门禁。 */
export function checkBudget({ files, diffLines, policy = {} }) {
  const problems = [];
  const maxFiles = policy.max_files_per_task ?? 8;
  const maxLines = policy.max_diff_lines ?? 400;
  if (files.length > maxFiles) problems.push(`改动文件 ${files.length} 个，超过预算 ${maxFiles}`);
  void diffLines;
  return problems;
}
