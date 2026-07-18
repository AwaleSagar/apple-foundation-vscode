import * as os from 'node:os';

/**
 * Apple's Foundation Models framework requires macOS 26 (Tahoe) or later on
 * Apple Silicon with Apple Intelligence enabled. Darwin kernel major 25 maps
 * to macOS 26 (macOS 27 reports Darwin 27, where Apple aligned the numbers).
 */
export const MIN_DARWIN_MAJOR = 25;

export interface HostInfo {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly darwinMajor: number | null;
}

export type Availability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

export function parseDarwinMajor(release: string): number | null {
  const match = /^(\d+)\./.exec(release.trim());
  if (match?.[1] === undefined) {
    return null;
  }
  const major = Number.parseInt(match[1], 10);
  return Number.isNaN(major) ? null : major;
}

export function checkHost(host: HostInfo): Availability {
  if (host.platform !== 'darwin') {
    return {
      available: false,
      reason: 'Apple Foundation Models are only available on macOS.',
    };
  }
  if (host.arch !== 'arm64') {
    return {
      available: false,
      reason: 'Apple Foundation Models require Apple Silicon (arm64).',
    };
  }
  if (host.darwinMajor === null || host.darwinMajor < MIN_DARWIN_MAJOR) {
    return {
      available: false,
      reason: 'Apple Foundation Models require macOS 26 (Tahoe) or later.',
    };
  }
  return { available: true };
}

export function currentHostInfo(): HostInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    darwinMajor: parseDarwinMajor(os.release()),
  };
}
