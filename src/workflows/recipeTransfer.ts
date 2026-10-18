import { validateRecipe, type WorkflowRecipe } from './workflowEngine';
export const MAX_RECIPE_BYTES = 65536;
export const DEFAULT_OUTPUT_PATTERN = '{name}-{index}-workflow';
export function exportRecipe(recipe: unknown): string {
  return JSON.stringify({ format: 'docflow-workflow', version: 1, recipe: validateRecipe(recipe) }, null, 2) + '\n';
}
export function importRecipe(json: string): WorkflowRecipe {
  if (new TextEncoder().encode(json).length > MAX_RECIPE_BYTES) throw Error('Recipe files must be at most 64 KB.');
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw Error('Choose a valid DocFlow recipe JSON file.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid recipe file.');
  const item = data as Record<string, unknown>;
  if (item.format !== 'docflow-workflow') throw Error('This is not a DocFlow workflow recipe.');
  if (item.version !== 1) throw Error('Unsupported recipe version. This app reads version 1.');
  return validateRecipe(item.recipe);
}
const safePart = (value: string): string => value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'document';
export function workflowOutputName(name: string, index: number, pattern: string, recipe: string): string {
  if (!pattern.trim() || pattern.length > 100 || /[{}]/.test(pattern.replace(/\{(name|index|recipe)\}/g, ''))) throw Error('Use {name}, {index} and {recipe} placeholders in a pattern of up to 100 characters.');
  const values: Record<string, string> = { name: safePart(name.replace(/\.pdf$/i, '')), index: String(index), recipe: safePart(recipe) };
  return safePart(pattern.replace(/\{(name|index|recipe)\}/g, (_, key: string) => values[key]!)).slice(0, 100) + '.pdf';
}
