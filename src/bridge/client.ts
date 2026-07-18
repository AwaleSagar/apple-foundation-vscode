import { SseParser } from './sse';
import type { ChatCompletionChunk, ChatCompletionRequest, ModelList } from './types';

/**
 * HTTP client for the bridge server's OpenAI-compatible API (`fm serve` on
 * macOS 27+, or the `afm` CLI on macOS 26).
 * All traffic stays on the loopback interface; there is no network egress.
 */
export class BridgeClient {
  constructor(private readonly baseUrl: string) {}

  async isHealthy(timeoutMs = 1500): Promise<boolean> {
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
      throw new Error(`Bridge server returned ${response.status} for /v1/models`);
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
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok || response.body === null) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Bridge server returned ${response.status} for /v1/chat/completions${detail ? `: ${detail}` : ''}`,
      );
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
 * Resolve the wire model id to send in requests. The name differs per bridge
 * ("system" for `fm serve`), so ask the server rather than hardcoding, and
 * fall back to the fm default if the listing is unavailable.
 */
export async function resolveWireModel(client: BridgeClient): Promise<string> {
  try {
    const models = await client.listModels();
    return models.includes('system') ? 'system' : (models[0] ?? 'system');
  } catch {
    return 'system';
  }
}
