import { tools, type ToolDefinition } from '../tools/registry';
import { productCopy } from '../content/en';

export function findTools(query: string, category = 'all'): ToolDefinition[] {
  const normalized = query.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const candidates = tools.filter(tool => {
    if (category !== 'all' && tool.category !== category) return false;
    const haystack = [tool.name, tool.description, ...tool.keywords, ...(productCopy.aliases[tool.id] ?? [])].join(' ').toLowerCase();
    return words.every(word => haystack.includes(word));
  });
  // Preserve precise phrase searches before broadening to independent words.
  const phrases = candidates.filter(tool => [tool.name, tool.description, ...tool.keywords, ...(productCopy.aliases[tool.id] ?? [])]
    .some(value => value.toLowerCase().includes(normalized)));
  return phrases.length ? phrases : candidates;
}
