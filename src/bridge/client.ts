import { asBridgeError, BridgeError, classifyHttpFailure } from '../core/errors';
import { SseParser } from './sse';
import type { ChatCompletionChunk, ChatCompletionRequest, ModelList } from './types';

/**
 * HTTP client for the bridge server's OpenAI-compatible API (`fm serve` on
 * macOS 27+, or the `afm` CLI on macOS 26).
 * All traffic stays on the loopback interface; there is no network egress.
 */
export class BridgeClient {
  constructor(private readonly baseUrl: string) {}

  /** Base URL this client targets (loopback only). */
  get url(): string {
    return this.baseUrl;
  }

  async isHealthy(timeoutMs = 1500): Promise<boolean> {
    // Prefer /health (fm serve); fall back to /v1/models for older bridges.
    try {
      const health = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (health.ok) {
        return true;
      }
    } catch {
      // fall through
    }
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw classifyHttpFailure(response.status, await response.text().catch(() => ''));
    }
    const body = (await response.json()) as ModelList;
    return (body.data ?? []).map((model) => model.id);
  }

  /**
   * Stream a chat completion, yielding text deltas as they arrive.
   * The caller aborts via `signal` (wired to VS Code's CancellationToken).
   */
  async *streamChat(
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new BridgeError('CANCELLED', 'Request cancelled.', { cause: error });
      }
      throw asBridgeError(error);
    }

    if (!response.ok || response.body === null) {
      const detail = await response.text().catch(() => '');
      throw classifyHttpFailure(response.status, detail);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
          if (payload === '[DONE]') {
            return;
          }
          const delta = extractDelta(payload);
          if (delta !== '') {
            yield delta;
          }
        }
      }
    } catch (error) {
      if (signal.aborted) {
        throw new BridgeError('CANCELLED', 'Request cancelled.', { cause: error });
      }
      throw asBridgeError(error);
    } finally {
      reader.releaseLock();
    }
  }
}

function extractDelta(payload: string): string {
  try {
    const chunk = JSON.parse(payload) as ChatCompletionChunk;
    return chunk.choices?.[0]?.delta?.content ?? '';
  } catch {
    // Tolerate malformed keep-alive or vendor-specific frames.
    return '';
  }
}

/**
 * Successful resolutions are cached per client instance: the model list
 * ("system"/"pcc") never changes for the life of a bridge process, and the
 * server manager reuses one client per port, so this removes a per-request
 * /v1/models round trip. Failures are not cached so a later success corrects.
 */
const wireModelCache = new WeakMap<BridgeClient, string>();

/**
 * Resolve the wire model id to send in requests. The name differs per bridge
 * ("system" for `fm serve`), so ask the server rather than hardcoding, and
 * fall back to the fm default if the listing is unavailable.
 */
export async function resolveWireModel(client: BridgeClient): Promise<string> {
  const cached = wireModelCache.get(client);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const models = await client.listModels();
    // Prefer the on-device system model; never auto-select PCC.
    const resolved = models.includes('system') ? 'system' : (models[0] ?? 'system');
    wireModelCache.set(client, resolved);
    return resolved;
  } catch {
    return 'system';
  }
}
