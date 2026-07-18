import { type ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BridgeConfig } from '../core/config';
import type { Logger } from '../core/logger';
import { BridgeClient } from './client';

const STARTUP_TIMEOUT_MS = 20_000;
const STARTUP_POLL_INTERVAL_MS = 500;

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
  return ['serve', '--port', String(port)];
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

  constructor(
    private readonly logger: Logger,
    private readonly getConfig: () => BridgeConfig,
  ) {}

  /** Returns a healthy client, starting the bridge process if permitted. */
  async ensureRunning(): Promise<BridgeClient> {
    const config = this.getConfig();
    const client = new BridgeClient(`http://127.0.0.1:${config.port}`);

    if (await client.isHealthy()) {
      return client;
    }

    if (!config.autoStart) {
      throw new Error(
        `No bridge server on port ${config.port} and auto-start is disabled. ` +
          `Start one with \`${config.executablePath} ${serverArgsFor(config.executablePath, config.port).join(' ')}\` ` +
          'or enable "appleFoundation.bridge.autoStart".',
      );
    }

    this.start(config);
    await this.waitUntilHealthy(client, config.port);
    return client;
  }

  async restart(): Promise<BridgeClient> {
    this.stop();
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
      }
    });

    this.process = child;
  }

  private async waitUntilHealthy(client: BridgeClient, port: number): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.process === undefined) {
        throw new Error(
          'Bridge process exited before becoming ready. ' +
            'Check the "Apple Foundation Models" output channel for details.',
        );
      }
      if (await client.isHealthy()) {
        this.logger.info(`Bridge is ready on 127.0.0.1:${port}`);
        return;
      }
      await delay(STARTUP_POLL_INTERVAL_MS);
    }
    this.stop();
    throw new Error(
      `Bridge did not become ready on port ${port} within ${STARTUP_TIMEOUT_MS / 1000}s. ` +
        'Verify Apple Intelligence is enabled in System Settings.',
    );
  }

  private stop(): void {
    if (this.process !== undefined) {
      this.logger.info('Stopping bridge process');
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
