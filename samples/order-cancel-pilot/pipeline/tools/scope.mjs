// 写域（scope）匹配与变更越界判定 —— 流水线里“任务只能改它该改的文件”的机械保证。

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

/** 静态前缀：通配符之前的固定路径部分，用于保守判断两个写域是否可能重叠。 */
export function staticPrefix(glob) {
  const p = normalizePath(glob);
  const idx = p.search(/[*?]/);
  const head = idx < 0 ? p : p.slice(0, idx);
  const lastSlash = head.lastIndexOf('/');
  return idx < 0 ? p : (lastSlash < 0 ? '' : head.slice(0, lastSlash));
}

export function mayOverlap(a, b) {
  if (normalizePath(a) === normalizePath(b)) return true;
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  if (!pa || !pb) return true;
  return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
}

/**
 * 判定一次任务的实际变更是否越界。
 * 允许 = 命中 card.scope.write 且未命中 (card.scope.deny ∪ policy.deny_write)
 */
export function checkChanges(files, card, policy = {}) {
  const write = card?.scope?.write || [];
  const deny = [...new Set([...(card?.scope?.deny || []), ...(policy.deny_write || [])])];
  const violations = [];
  const allowed = [];
  for (const file of files) {
    const denied = matchesAny(file, deny);
    const writable = matchesAny(file, write);
    if (denied) {
      violations.push({ file, reason: 'deny', detail: `命中禁止写入规则（${deny.join(', ')}）` });
    } else if (!writable) {
      violations.push({ file, reason: 'out_of_scope', detail: `未命中写域（${write.join(', ')}）` });
    } else {
      allowed.push(file);
    }
  }
  return { allowed, violations };
}
