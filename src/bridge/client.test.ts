import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../core/errors';
import { BridgeClient, resolveWireModel } from './client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(frames: string[], status = 200): Response {
  const body = frames.map((f) => `data: ${f}\n\n`).join('');
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('BridgeClient.isHealthy', () => {
  it('returns true when /health is ok', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return jsonResponse({ status: 'ok' });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const client = new BridgeClient('http://127.0.0.1:9999');
    await expect(client.isHealthy()).resolves.toBe(true);
  });

  it('falls back to /v1/models when /health fails', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        throw new Error('no health');
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse({ data: [] });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const client = new BridgeClient('http://127.0.0.1:9999');
    await expect(client.isHealthy()).resolves.toBe(true);
  });

  it('returns false when both endpoints fail', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('down');
    }) as typeof fetch;
    const client = new BridgeClient('http://127.0.0.1:9999');
    await expect(client.isHealthy()).resolves.toBe(false);
  });
});

describe('BridgeClient.listModels', () => {
  it('maps model ids from the OpenAI-compatible list', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'system' }, { id: 'pcc' }] }),
    ) as typeof fetch;
    const client = new BridgeClient('http://127.0.0.1:9999');
    await expect(client.listModels()).resolves.toEqual(['system', 'pcc']);
  });

  it('throws BridgeError on non-OK status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 })) as typeof fetch;
    const client = new BridgeClient('http://127.0.0.1:9999');
    await expect(client.listModels()).rejects.toBeInstanceOf(BridgeError);
  });
});

describe('BridgeClient.streamChat', () => {
  it('yields text deltas from SSE frames', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
        '[DONE]',
      ]),
    ) as typeof fetch;

    const client = new BridgeClient('http://127.0.0.1:9999');
    const parts: string[] = [];
    for await (const delta of client.streamChat(
      { model: 'system', messages: [{ role: 'user', content: 'hi' }], stream: true },
      new AbortController().signal,
    )) {
      parts.push(delta);
    }
    expect(parts.join('')).toBe('Hello');
  });

  it('classifies guardrail HTTP failures', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('guardrail blocked this prompt', { status: 400 }),
    ) as typeof fetch;

    const client = new BridgeClient('http://127.0.0.1:9999');
    const gen = client.streamChat(
      { model: 'system', messages: [{ role: 'user', content: 'x' }], stream: true },
      new AbortController().signal,
    );
    await expect(gen.next()).rejects.toMatchObject({ code: 'GUARDRAIL' });
  });
});

describe('resolveWireModel', () => {
  it('prefers system over pcc', async () => {
    const client = {
      listModels: async () => ['pcc', 'system'],
    } as unknown as BridgeClient;
    await expect(resolveWireModel(client)).resolves.toBe('system');
  });

  it('falls back to system when listing fails', async () => {
    const client = {
      listModels: async () => {
        throw new Error('down');
      },
    } as unknown as BridgeClient;
    await expect(resolveWireModel(client)).resolves.toBe('system');
  });

  it('caches successful resolutions per client instance', async () => {
    let calls = 0;
    const client = {
      listModels: async () => {
        calls += 1;
        return ['system'];
      },
    } as unknown as BridgeClient;
    await resolveWireModel(client);
    await resolveWireModel(client);
    expect(calls).toBe(1);
  });

  it('offlineOnly returns system when the bridge offers it', async () => {
    const client = {
      listModels: async () => ['pcc', 'system'],
    } as unknown as BridgeClient;
    await expect(resolveWireModel(client, { offlineOnly: true })).resolves.toBe('system');
  });

  it('offlineOnly refuses a bridge without the on-device model', async () => {
    const client = {
      listModels: async () => ['some-cloud-model'],
    } as unknown as BridgeClient;
    await expect(resolveWireModel(client, { offlineOnly: true })).rejects.toMatchObject({
      code: 'BRIDGE_UNAVAILABLE',
    });
  });

  it('offlineOnly ignores a cached non-system resolution', async () => {
    const client = {
      listModels: async () => ['other-model'],
    } as unknown as BridgeClient;
    // First resolution (permissive) caches "other-model"…
    await expect(resolveWireModel(client)).resolves.toBe('other-model');
    // …but offline-only must not trust that cache.
    await expect(resolveWireModel(client, { offlineOnly: true })).rejects.toMatchObject({
      code: 'BRIDGE_UNAVAILABLE',
    });
  });
});
