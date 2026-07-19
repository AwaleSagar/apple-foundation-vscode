import { describe, expect, it } from 'vitest';
import { matchDeniedGlob, resolveSandboxPath } from './paths';

describe('matchDeniedGlob', () => {
  it('matches .env patterns', () => {
    expect(matchDeniedGlob('.env', '**/.env*')).toBe(true);
    expect(matchDeniedGlob('config/.env.local', '**/.env*')).toBe(true);
    expect(matchDeniedGlob('src/app.ts', '**/.env*')).toBe(false);
  });
});

describe('resolveSandboxPath', () => {
  const folders = ['/Users/me/project'];

  it('resolves relative paths', () => {
    const r = resolveSandboxPath('src/a.ts', {
      workspaceFolders: folders,
      deniedGlobs: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.absolutePath).toBe('/Users/me/project/src/a.ts');
      expect(r.relativePath).toBe('src/a.ts');
    }
  });

  it('rejects paths outside workspace', () => {
    const r = resolveSandboxPath('/etc/passwd', {
      workspaceFolders: folders,
      deniedGlobs: [],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects denied globs', () => {
    const r = resolveSandboxPath('.env', {
      workspaceFolders: folders,
      deniedGlobs: ['**/.env*'],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects parent traversal', () => {
    const r = resolveSandboxPath('../secret', {
      workspaceFolders: folders,
      deniedGlobs: [],
    });
    expect(r.ok).toBe(false);
  });
});
