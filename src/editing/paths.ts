/**
 * Pure path sandbox helpers (no VS Code). Callers pass workspace folder
 * filesystem paths and denied glob-ish patterns.
 */

export interface PathSandboxOptions {
  /** Absolute filesystem paths of workspace folders. */
  readonly workspaceFolders: readonly string[];
  /** Simple deny patterns: substring or suffix globs like **\/.env* */
  readonly deniedGlobs: readonly string[];
}

export type PathCheckResult =
  | { readonly ok: true; readonly absolutePath: string; readonly relativePath: string }
  | { readonly ok: false; readonly reason: string };

function normalizeFs(p: string): string {
  // Unify separators; strip trailing slash (except root)
  let s = p.replace(/\\/g, '/');
  if (s.length > 1 && s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}

function isUnder(parent: string, child: string): boolean {
  const p = normalizeFs(parent);
  const c = normalizeFs(child);
  return c === p || c.startsWith(`${p}/`);
}

function globToRegExp(pattern: string): RegExp {
  const parts = pattern.split('**');
  const regexParts = parts.map((part) =>
    part
      .split('*')
      .map((s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*'),
  );
  return new RegExp(`^${regexParts.join('.*')}$`, 'i');
}

/** Very small glob matcher: supports ** and * only. */
export function matchDeniedGlob(relativePath: string, pattern: string): boolean {
  const path = normalizeFs(relativePath).replace(/^\.\//, '');
  const pat = normalizeFs(pattern);
  const fullRe = globToRegExp(pat);
  if (fullRe.test(path)) {
    return true;
  }
  const base = path.split('/').pop() ?? path;
  if (fullRe.test(base)) {
    return true;
  }
  // `**/foo*` should also match top-level `foo*` / basename
  const stripped = pat.replace(/^\*\*\//, '').replace(/^\*\*/, '');
  if (stripped !== pat) {
    const baseRe = globToRegExp(stripped);
    if (baseRe.test(base) || baseRe.test(path)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a model-supplied path against workspace folders and deny lists.
 * `path` may be workspace-relative or absolute.
 */
export function resolveSandboxPath(path: string, options: PathSandboxOptions): PathCheckResult {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed.includes('\0')) {
    return { ok: false, reason: 'Empty or invalid path' };
  }
  if (trimmed.includes('..')) {
    const rough = normalizeFs(trimmed);
    if (rough.split('/').includes('..')) {
      return { ok: false, reason: 'Path must not contain ".."' };
    }
  }

  if (options.workspaceFolders.length === 0) {
    return { ok: false, reason: 'No workspace folder open' };
  }

  const isAbs = trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed);
  let absolute: string | undefined;
  let relative: string | undefined;

  if (isAbs) {
    const abs = normalizeFs(trimmed);
    const folder = options.workspaceFolders.find((f) => isUnder(f, abs));
    if (folder === undefined) {
      return { ok: false, reason: 'Path is outside the workspace' };
    }
    absolute = abs;
    relative = abs.slice(normalizeFs(folder).length).replace(/^\//, '');
  } else {
    const rel = normalizeFs(trimmed).replace(/^\.\//, '');
    for (const folder of options.workspaceFolders) {
      const candidate = normalizeFs(`${normalizeFs(folder)}/${rel}`);
      if (isUnder(folder, candidate)) {
        absolute = candidate;
        relative = rel;
        break;
      }
    }
    if (absolute === undefined || relative === undefined) {
      return { ok: false, reason: 'Could not resolve path inside workspace' };
    }
  }

  for (const glob of options.deniedGlobs) {
    if (matchDeniedGlob(relative, glob) || matchDeniedGlob(absolute, glob)) {
      return { ok: false, reason: `Path matches denied pattern (${glob})` };
    }
  }

  return { ok: true, absolutePath: absolute, relativePath: relative };
}
