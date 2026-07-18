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

export const workspace = {
  getConfiguration: () => ({
    get: () => undefined,
  }),
};

export const window = {
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
};
