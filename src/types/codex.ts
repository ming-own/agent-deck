/** Non-sensitive model catalog returned for the connected Codex account. */
export type CodexModel = { id: string; name: string };
export type CodexModelsResult = {
  success: boolean;
  models: CodexModel[];
  error_code?: string;
};
