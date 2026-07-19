import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIDGE_CONFIG, maxInputTokens, normalizeBridgeConfig } from './config';

describe('normalizeBridgeConfig', () => {
  it('returns defaults for an empty object', () => {
    expect(normalizeBridgeConfig({})).toEqual(DEFAULT_BRIDGE_CONFIG);
  });

  it('keeps valid values', () => {
    const config = normalizeBridgeConfig({
      executablePath: '/opt/homebrew/bin/afm',
      port: 8080,
      autoStart: false,
      maxOutputTokens: 512,
      maxContextTokens: 8192,
      idleTimeoutMinutes: 10,
      offlineOnlyMode: true,
    });
    expect(config).toEqual({
      executablePath: '/opt/homebrew/bin/afm',
      port: 8080,
      autoStart: false,
      maxOutputTokens: 512,
      maxContextTokens: 8192,
      idleTimeoutMinutes: 10,
      offlineOnlyMode: true,
    });
  });

  it('clamps out-of-range ports', () => {
    expect(normalizeBridgeConfig({ port: 80 }).port).toBe(1024);
    expect(normalizeBridgeConfig({ port: 99999 }).port).toBe(65535);
  });

  it('falls back on non-integer ports', () => {
    expect(normalizeBridgeConfig({ port: 3000.5 }).port).toBe(DEFAULT_BRIDGE_CONFIG.port);
  });

  it('trims and defaults blank executable paths', () => {
    expect(normalizeBridgeConfig({ executablePath: '  ' }).executablePath).toBe('fm');
    expect(normalizeBridgeConfig({ executablePath: ' /usr/local/bin/afm ' }).executablePath).toBe(
      '/usr/local/bin/afm',
    );
  });

  it('clamps and floors maxOutputTokens', () => {
    expect(normalizeBridgeConfig({ maxOutputTokens: 1 }).maxOutputTokens).toBe(16);
    expect(
      normalizeBridgeConfig({ maxOutputTokens: 10000, maxContextTokens: 32768 }).maxOutputTokens,
    ).toBe(8192);
    expect(normalizeBridgeConfig({ maxOutputTokens: 100.9 }).maxOutputTokens).toBe(100);
  });

  it('lowers a conflicting output cap instead of inflating the context window', () => {
    const config = normalizeBridgeConfig({ maxOutputTokens: 3000, maxContextTokens: 3100 });
    expect(config.maxContextTokens).toBe(3100);
    expect(config.maxOutputTokens).toBe(3100 - 256);
    expect(config.maxContextTokens - config.maxOutputTokens).toBeGreaterThanOrEqual(256);
  });

  it('never inflates the window when output exceeds the default context', () => {
    const config = normalizeBridgeConfig({ maxOutputTokens: 8192 });
    expect(config.maxContextTokens).toBe(4096);
    expect(config.maxOutputTokens).toBe(4096 - 256);
  });

  it('clamps idle timeout', () => {
    expect(normalizeBridgeConfig({ idleTimeoutMinutes: -1 }).idleTimeoutMinutes).toBe(0);
    expect(normalizeBridgeConfig({ idleTimeoutMinutes: 999 }).idleTimeoutMinutes).toBe(120);
  });
});

describe('maxInputTokens', () => {
  it('subtracts output reserve and applies the estimator safety margin', () => {
    const config = normalizeBridgeConfig({ maxContextTokens: 4096, maxOutputTokens: 1024 });
    // (4096 - 1024) * 0.75 — headroom for the ~4-chars/token estimator's error.
    expect(maxInputTokens(config)).toBe(2304);
  });

  it('never drops below the 256-token floor', () => {
    const config = normalizeBridgeConfig({ maxContextTokens: 512, maxOutputTokens: 4096 });
    expect(maxInputTokens(config)).toBeGreaterThanOrEqual(256);
  });
});
