/**
 * Live integration against the system `fm serve` bridge when present.
 * Skips cleanly on machines without the CLI (e.g. Linux CI).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countTokensWithCli } from '../core/tokens';
import { BridgeClient, resolveWireModel } from './client';

const PORT = 19_876;
const BASE = `http://127.0.0.1:${PORT}`;

async function canRunFm(): Promise<boolean> {
  const count = await countTokensWithCli('ping', {
    executablePath: 'fm',
    timeoutMs: 8000,
  });
  return count !== undefined;
}

describe('BridgeClient live (fm serve)', () => {
  let child: ChildProcess | undefined;
  let enabled = false;

  beforeAll(async () => {
    enabled = await canRunFm();
    if (!enabled) {
      return;
    }

    // Reuse an already-running server on this port if present.
    const probe = new BridgeClient(BASE);
    if (await probe.isHealthy(500)) {
      return;
    }

    child = spawn('fm', ['serve', '--host', '127.0.0.1', '--port', String(PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (await probe.isHealthy(400)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    enabled = false;
  }, 30_000);

  afterAll(() => {
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  });

  it('lists models including system', async () => {
    if (!enabled) {
      return;
    }
    const client = new BridgeClient(BASE);
    const models = await client.listModels();
    expect(models).toContain('system');
    await expect(resolveWireModel(client)).resolves.toBe('system');
  });

  it('streams a short completion from the on-device model', async () => {
    if (!enabled) {
      return;
    }
    const client = new BridgeClient(BASE);
    const parts: string[] = [];
    for await (const delta of client.streamChat(
      {
        model: 'system',
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        stream: true,
        max_tokens: 16,
      },
      AbortSignal.timeout(30_000),
    )) {
      parts.push(delta);
    }
    const text = parts.join('');
    expect(text.length).toBeGreaterThan(0);
  }, 45_000);

  it('reports healthy via /health', async () => {
    if (!enabled) {
      return;
    }
    await expect(new BridgeClient(BASE).isHealthy()).resolves.toBe(true);
  });
});
