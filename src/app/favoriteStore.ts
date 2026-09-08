const FAVORITES_KEY = 'docflow.favorites.v1';

type FavoritesListener = (favorites: ReadonlySet<string>) => void;

const listeners = new Set<FavoritesListener>();

function readFavorites(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

let favorites = readFavorites();

function emit(): void {
  const snapshot = new Set(favorites);
  listeners.forEach((listener) => listener(snapshot));
}

function persist(): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

export function getFavorites(): Set<string> {
  return new Set(favorites);
}

export function isFavorite(toolId: string): boolean {
  return favorites.has(toolId);
}

export function setFavorite(toolId: string, enabled: boolean): void {
  const changed = enabled ? !favorites.has(toolId) : favorites.has(toolId);
  if (!changed) return;
  if (enabled) favorites.add(toolId);
  else favorites.delete(toolId);
  persist();
  emit();
}

export function toggleFavorite(toolId: string): boolean {
  const enabled = !favorites.has(toolId);
  setFavorite(toolId, enabled);
  return enabled;
}

export function subscribeFavorites(listener: FavoritesListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

window.addEventListener('storage', (event) => {
  if (event.key !== FAVORITES_KEY) return;
  favorites = readFavorites();
  emit();
});
