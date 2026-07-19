import { type ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BridgeConfig } from '../core/config';
import { BridgeError } from '../core/errors';
import type { Logger } from '../core/logger';
import { BridgeClient } from './client';

const STARTUP_TIMEOUT_MS = 20_000;
const STARTUP_POLL_INTERVAL_MS = 500;
/** Skip the per-request health probe when the bridge answered this recently. */
const HEALTH_CACHE_MS = 3000;

/**
 * Compute spawn arguments for the configured bridge executable.
 *
 * Two OpenAI-compatible bridges are supported: the `fm` CLI preinstalled on
 * macOS 27+ (`fm serve --port N`) and the Homebrew `afm` CLI for macOS 26
 * (`afm -p N`). The flag shape is keyed off the executable name.
 */
export function serverArgsFor(executablePath: string, port: number): string[] {
  const name = path.basename(executablePath);
  if (name === 'afm' || name.startsWith('afm-')) {
    return ['-p', String(port)];
  }
  // Bind to loopback explicitly when the CLI supports --host (fm serve).
  return ['serve', '--host', '127.0.0.1', '--port', String(port)];
}

/**
 * Owns the lifecycle of the bridge process.
 *
 * If a bridge server is already listening on the configured port (for example
 * one the user started manually), it is reused and never killed by us — the
 * manager only ever terminates processes it spawned itself.
 */
export class BridgeServerManager {
  private process: ChildProcess | undefined;
  /** True when `this.process` was spawned by us (vs. reused external). */
  private ownsProcess = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUsedAt = 0;
  private client: BridgeClient | undefined;
  private lastHealthyAt = 0;
  /** Requests currently streaming; the idle timer never fires while > 0. */
  private activeRequests = 0;

  constructor(
    private readonly logger: Logger,
    private readonly getConfig: () => BridgeConfig,
  ) {}

  /** Returns a healthy client, starting the bridge process if permitted. */
  async ensureRunning(): Promise<BridgeClient> {
    const config = this.getConfig();
    const url = `http://127.0.0.1:${config.port}`;
    if (this.client === undefined || this.client.url !== url) {
      this.client = new BridgeClient(url);
      this.lastHealthyAt = 0;
    }
    const client = this.client;

    // Recently verified healthy — skip the probe on the hot path.
    if (Date.now() - this.lastHealthyAt < HEALTH_CACHE_MS) {
      this.touchIdleTimer(config);
      return client;
    }

    if (await client.isHealthy()) {
      this.lastHealthyAt = Date.now();
      this.touchIdleTimer(config);
      return client;
    }

    if (!config.autoStart) {
      throw new BridgeError(
        'BRIDGE_UNAVAILABLE',
        `No bridge server on port ${config.port} and auto-start is disabled.`,
        {
          actionable:
            `Start one with \`${config.executablePath} ${serverArgsFor(config.executablePath, config.port).join(' ')}\` ` +
            'or enable "appleFoundation.bridge.autoStart".',
        },
      );
    }

    this.start(config);
    await this.waitUntilHealthy(client, config);
    this.lastHealthyAt = Date.now();
    this.touchIdleTimer(config);
    return client;
  }

  /**
   * Cached, non-spawning health probe for UI surfaces (status bar). Never
   * starts a process and never throws.
   */
  async checkHealth(): Promise<boolean> {
    const config = this.getConfig();
    const url = `http://127.0.0.1:${config.port}`;
    if (this.client === undefined || this.client.url !== url) {
      this.client = new BridgeClient(url);
      this.lastHealthyAt = 0;
    }
    if (Date.now() - this.lastHealthyAt < HEALTH_CACHE_MS) {
      return true;
    }
    const healthy = await this.client.isHealthy().catch(() => false);
    if (healthy) {
      this.lastHealthyAt = Date.now();
    }
    return healthy;
  }

  /**
   * Mark a request as in flight so the idle timer cannot stop the bridge while
   * a response is still streaming. Call the returned function when the request
   * settles (success, error, or cancellation); it re-arms the idle clock.
   */
  beginRequest(): () => void {
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeRequests -= 1;
      this.touchIdleTimer(this.getConfig());
    };
  }

  async restart(): Promise<BridgeClient> {
    this.stopOwned();
    return this.ensureRunning();
  }

  private start(config: BridgeConfig): void {
    if (this.process !== undefined && this.process.exitCode === null) {
      return;
    }

    const args = serverArgsFor(config.executablePath, config.port);
    this.logger.info(`Starting bridge: ${config.executablePath} ${args.join(' ')}`);
    const child = spawn(config.executablePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      this.logger.debug(`[bridge] ${data.toString().trimEnd()}`);
    });
    child.stderr?.on('data', (data: Buffer) => {
      this.logger.warn(`[bridge] ${data.toString().trimEnd()}`);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        this.logger.error(
          `Bridge executable "${config.executablePath}" not found. ` +
            'On macOS 27+ the system `fm` CLI is preinstalled; on macOS 26 install ' +
            'the fallback bridge with: brew install scouzi1966/afm/afm',
        );
      } else {
        this.logger.error(`Bridge process error: ${error.message}`);
      }
    });
    child.on('exit', (code, signal) => {
      this.logger.info(`Bridge exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`);
      if (this.process === child) {
        this.process = undefined;
        this.ownsProcess = false;
      }
    });

    this.process = child;
    this.ownsProcess = true;
  }

  private async waitUntilHealthy(client: BridgeClient, config: BridgeConfig): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.process === undefined) {
        throw new BridgeError('BRIDGE_NOT_FOUND', 'Bridge process exited before becoming ready.', {
          actionable:
            `Confirm \`${config.executablePath}\` is installed and Apple Intelligence is enabled. ` +
            'Check the "Apple Foundation Models" output channel for details.',
        });
      }
      if (await client.isHealthy()) {
        this.logger.info(`Bridge is ready on 127.0.0.1:${config.port}`);
        return;
      }
      await delay(STARTUP_POLL_INTERVAL_MS);
    }
    this.stopOwned();
    throw new BridgeError(
      'BRIDGE_TIMEOUT',
      `Bridge did not become ready on port ${config.port} within ${STARTUP_TIMEOUT_MS / 1000}s.`,
      {
        actionable:
          'Verify Apple Intelligence is enabled in System Settings → Apple Intelligence & Siri, ' +
          'then run Apple Foundation Models: Show Logs.',
      },
    );
  }

  private touchIdleTimer(config: BridgeConfig): void {
    this.lastUsedAt = Date.now();
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (!this.ownsProcess || config.idleTimeoutMinutes <= 0) {
      return;
    }
    const ms = config.idleTimeoutMinutes * 60_000;
    this.idleTimer = setTimeout(() => {
      // A response may still be streaming long after the request started;
      // never stop mid-flight — re-arm and check again next interval.
      if (this.activeRequests > 0) {
        this.touchIdleTimer(config);
        return;
      }
      // Only stop if nothing used the bridge since we scheduled the timer.
      if (Date.now() - this.lastUsedAt >= ms - 50) {
        this.logger.info(
          `Idle timeout (${config.idleTimeoutMinutes}m) reached; stopping owned bridge process.`,
        );
        this.stopOwned();
      }
    }, ms);
    // Don't keep the extension host alive solely for the idle timer.
    this.idleTimer.unref?.();
  }

  private stopOwned(): void {
    this.lastHealthyAt = 0;
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.process !== undefined && this.ownsProcess) {
      this.logger.info('Stopping bridge process');
      this.process.kill('SIGTERM');
      this.process = undefined;
      this.ownsProcess = false;
    }
  }

  dispose(): void {
    this.stopOwned();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
