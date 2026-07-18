/**
 * Minimal OpenAI-compatible wire types for the `afm` bridge server.
 * Only the fields this extension actually uses are modeled.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly stream: true;
  readonly max_tokens?: number;
  readonly temperature?: number;
}

export interface ChatCompletionChunk {
  readonly choices?: readonly {
    readonly delta?: { readonly content?: string };
    readonly finish_reason?: string | null;
  }[];
}

export interface ModelList {
  readonly data?: readonly { readonly id: string }[];
}
