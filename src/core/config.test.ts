import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIDGE_CONFIG, normalizeBridgeConfig } from './config';

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
    });
    expect(config).toEqual({
      executablePath: '/opt/homebrew/bin/afm',
      port: 8080,
      autoStart: false,
      maxOutputTokens: 512,
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
    expect(normalizeBridgeConfig({ maxOutputTokens: 10000 }).maxOutputTokens).toBe(4096);
    expect(normalizeBridgeConfig({ maxOutputTokens: 100.9 }).maxOutputTokens).toBe(100);
  });
});
