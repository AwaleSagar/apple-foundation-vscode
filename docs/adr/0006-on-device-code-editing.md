# ADR-0006: On-device code editing via WorkspaceEdit + EditPlan

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Users expect modern AI coding assistants to modify workspace files. This extension must do so
while remaining fully local (Apple Foundation Models on-device), privacy-first, and aligned with
VS Code extension APIs — without depending on product-private Copilot editing sessions.

Leading open systems (Aider, Cline/Roo, Codex) converge on content-anchored patches
(SEARCH/REPLACE or context patches), layered matching, preview/approval, and structured
failure feedback. The ~3B on-device model is weak at free-form unified diffs and cannot afford
a Cursor-style second “apply” model.

## Decision

1. **Canonical IR:** `EditPlan` JSON (`summary` + `changes[]` with SEARCH/REPLACE hunks).
   Fallback parse of Aider-style SEARCH/REPLACE blocks when JSON fails.
2. **Apply path:** only `vscode.workspace.applyEdit(WorkspaceEdit)` — never raw `fs` writes to
   open buffers — for native undo and multi-file atomicity.
3. **Preview first:** stage plans in memory; show `vscode.diff` against an `apple-fm-preview`
   virtual document; Apply / Reject command buttons in chat. No silent auto-apply by default.
4. **Orchestration:** `@apple /edit` owns the MVP loop (chat completions + parse). Register
   Language Model Tools and native tool-calling later when the bridge supports them.
5. **Security:** Workspace Trust, path sandbox under workspace folders, denied globs for
   secrets, confirmation before mutate, no shell tools in MVP.

## Alternatives considered

- **Whole-file rewrites only** — simpler for the model, destructive and slow; allowed only under
  a line-count cap.
- **Direct `TextEditor.edit`** — insufficient for multi-file and non-active documents.
- **Cursor-style apply model** — higher quality location, but doubles latency/context cost on
  on-device hardware; rejected for MVP.
- **MCP tools for edits** — portable but no deep VS Code editor integration; LM tools preferred
  for editor-aware mutations.

## Consequences

- New `src/editing/` module (pure parse/match + thin VS Code apply/preview).
- Participant gains `/edit`; settings under `appleFoundation.editing.*`.
- Match quality and model instruction-following become product metrics; eval fixtures live
  next to unit tests.
- Bridge remains Chat Completions for now; guided generation / tool parts are a later upgrade
  without changing the EditPlan IR.
