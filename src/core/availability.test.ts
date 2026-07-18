import { describe, expect, it } from 'vitest';
import { checkHost, MIN_DARWIN_MAJOR, parseDarwinMajor } from './availability';

describe('parseDarwinMajor', () => {
  it('parses a standard darwin release string', () => {
    expect(parseDarwinMajor('25.1.0')).toBe(25);
  });

  it('parses with surrounding whitespace', () => {
    expect(parseDarwinMajor(' 27.0.0 ')).toBe(27);
  });

  it('returns null for garbage input', () => {
    expect(parseDarwinMajor('not-a-release')).toBeNull();
    expect(parseDarwinMajor('')).toBeNull();
  });
});

describe('checkHost', () => {
  const supported = { platform: 'darwin', arch: 'arm64', darwinMajor: MIN_DARWIN_MAJOR } as const;

  it('accepts a supported host', () => {
    expect(checkHost(supported)).toEqual({ available: true });
  });

  it('rejects non-macOS platforms', () => {
    const result = checkHost({ ...supported, platform: 'linux' });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toContain('macOS');
    }
  });

  it('rejects Intel Macs', () => {
    const result = checkHost({ ...supported, arch: 'x64' });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toContain('Apple Silicon');
    }
  });

  it('rejects macOS versions before Tahoe', () => {
    const result = checkHost({ ...supported, darwinMajor: MIN_DARWIN_MAJOR - 1 });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toContain('macOS 26');
    }
  });

  it('rejects unknown OS versions', () => {
    const result = checkHost({ ...supported, darwinMajor: null });
    expect(result.available).toBe(false);
  });

  it('accepts newer macOS versions', () => {
    expect(checkHost({ ...supported, darwinMajor: MIN_DARWIN_MAJOR + 2 })).toEqual({
      available: true,
    });
  });
});
