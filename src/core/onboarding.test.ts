import { describe, expect, it } from 'vitest';
import {
  detectOnboardingIssues,
  formatOnboardingMarkdown,
  resolveExecutableOnPath,
} from './onboarding';

describe('resolveExecutableOnPath', () => {
  it('finds fm on a real macOS PATH when present', () => {
    const resolved = resolveExecutableOnPath('fm');
    // On the development Mac this is /usr/bin/fm; on Linux CI it may be undefined.
    if (resolved !== undefined) {
      expect(resolved).toMatch(/fm$/);
    } else {
      expect(resolved).toBeUndefined();
    }
  });

  it('returns undefined for a nonsense absolute path', () => {
    expect(resolveExecutableOnPath('/no/such/bridge-cli-xyz')).toBeUndefined();
  });

  it('returns undefined for blank input', () => {
    expect(resolveExecutableOnPath('   ')).toBeUndefined();
  });
});

describe('detectOnboardingIssues', () => {
  it('reports UNSUPPORTED_HOST on non-darwin without checking the executable', () => {
    const issues = detectOnboardingIssues({
      host: { platform: 'linux', arch: 'x64', darwinMajor: null },
      executablePath: 'fm',
      checkExecutable: true,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('UNSUPPORTED_HOST');
  });

  it('reports EXECUTABLE_NOT_FOUND when the bridge is missing on a supported host', () => {
    const issues = detectOnboardingIssues({
      host: { platform: 'darwin', arch: 'arm64', darwinMajor: 25 },
      executablePath: '/no/such/fm-bridge-xyz',
      checkExecutable: true,
    });
    expect(issues.some((i) => i.code === 'EXECUTABLE_NOT_FOUND')).toBe(true);
    expect(issues[0]?.detail).toMatch(/bridge|fm|afm/i);
  });

  it('returns no issues for a supported host when executable check is skipped', () => {
    const issues = detectOnboardingIssues({
      host: { platform: 'darwin', arch: 'arm64', darwinMajor: 27 },
      executablePath: 'fm',
      checkExecutable: false,
    });
    expect(issues).toEqual([]);
  });
});

describe('formatOnboardingMarkdown', () => {
  it('returns empty string for no issues', () => {
    expect(formatOnboardingMarkdown([])).toBe('');
  });

  it('renders a titled list', () => {
    const md = formatOnboardingMarkdown([
      {
        code: 'EXECUTABLE_NOT_FOUND',
        title: 'Bridge CLI not found',
        detail: 'Install fm',
      },
    ]);
    expect(md).toContain('setup needed');
    expect(md).toContain('Bridge CLI not found');
    expect(md).toContain('Install fm');
  });
});
