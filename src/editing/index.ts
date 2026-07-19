export { applyStagedEdit, preparePlan, rollbackLastApplied } from './apply';
export { alignReplaceIndent, detectIndentUnit } from './indent';
export { findHunk } from './match';
export { parseEditPlan } from './parse';
export { matchDeniedGlob, resolveSandboxPath } from './paths';
export {
  openAllStagedDiffs,
  openDiffForPath,
  PREVIEW_SCHEME,
  previewUriFor,
  registerPreviewProvider,
} from './preview';
export { applyResolvedHunksToText, resolveEditPlan } from './resolve';
export { validateEditPlan } from './schema';
export {
  clearStagedEdit,
  getLastApplied,
  getStagedEdit,
  stageEdit,
} from './session';
export type {
  ApplyResult,
  EditHunk,
  EditLimits,
  EditPlan,
  FileApplyOutcome,
  FileChange,
} from './types';
export { DEFAULT_EDIT_LIMITS } from './types';
