/**
 * Minimal stub of the `vscode` module for unit tests.
 *
 * Unit tests cover pure logic only; anything needing real editor behavior
 * belongs in integration tests run inside the Extension Host. Extend this stub
 * only with members that units under test actually touch.
 */

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

export class LanguageModelTextPart {
  constructor(readonly value: string) {}
}

export interface LanguageModelChatRequestMessage {
  readonly role: LanguageModelChatMessageRole;
  readonly content: readonly unknown[];
  readonly name: string | undefined;
}

export class MarkdownString {
  constructor(public value: string) {}
}

export class ChatRequestTurn {
  constructor(readonly prompt: string) {}
}

export class ChatResponseMarkdownPart {
  constructor(readonly value: MarkdownString) {}
}

export class ChatResponseTurn {
  constructor(readonly response: readonly ChatResponseMarkdownPart[]) {}
}

export interface ChatContext {
  readonly history: readonly (ChatRequestTurn | ChatResponseTurn)[];
}

export class Uri {
  static file(path: string): Uri {
    return new Uri('file', path);
  }
  static from(components: { scheme: string; path: string }): Uri {
    return new Uri(components.scheme, components.path);
  }
  constructor(
    readonly scheme: string,
    readonly path: string,
  ) {}
  get fsPath(): string {
    return this.path;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export class WorkspaceEdit {
  replace(): void {}
  insert(): void {}
  delete(): void {}
  createFile(): void {}
  deleteFile(): void {}
}

export class EventEmitter<T> {
  readonly event = (_listener: (e: T) => void) => ({ dispose: () => undefined });
  fire(_data: T): void {}
}

export const workspace = {
  getConfiguration: () => ({
    get: () => undefined,
  }),
  workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,
  isTrusted: true,
  textDocuments: [] as { uri: Uri; getText: () => string; positionAt: (o: number) => Position }[],
  applyEdit: async () => true,
  openTextDocument: async () => ({
    getText: () => '',
    positionAt: (o: number) => new Position(0, o),
    uri: Uri.file('/tmp'),
  }),
  fs: {
    readFile: async () => new Uint8Array(),
  },
  registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
  asRelativePath: (uri: Uri | string) => (typeof uri === 'string' ? uri : uri.path),
  getWorkspaceFolder: () => undefined,
};

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  createOutputChannel: () => ({
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: () => Promise.resolve(undefined),
};

export const lm = {
  registerLanguageModelChatProvider: () => ({ dispose: () => undefined }),
};

export const chat = {
  createChatParticipant: () => ({
    iconPath: undefined,
    followupProvider: undefined,
    dispose: () => undefined,
  }),
};

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export const extensions = {
  getExtension: () => undefined,
};
