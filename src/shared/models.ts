export type GenerationSettings = { model: string | null; effort: string | null };
export type ModelOption = {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
};
export type ModelCatalog = { models: ModelOption[]; defaultModel: string | null; defaultEffort: string | null };
export const defaultGeneration = (): GenerationSettings => ({ model: null, effort: null });
export function resolveGeneration(catalog: ModelCatalog, settings: GenerationSettings): GenerationSettings {
  const model = settings.model ?? catalog.defaultModel;
  const option = catalog.models.find(m => m.model === model);
  const suggested = settings.model === null ? catalog.defaultEffort : option?.defaultReasoningEffort;
  const effort = settings.effort ?? suggested ?? option?.defaultReasoningEffort ?? null;
  return { model, effort };
}
