export type PageRoute = { kind: 'home' } | { kind: 'tool'; toolId: string } | { kind: 'result'; id: string } | { kind: 'missing' };

export function parsePageRoute(hash: string, ids: ReadonlySet<string>): PageRoute {
  if (!hash.startsWith('#/')) return { kind: 'home' };
  if (hash === '#/' || hash === '#/tools') return { kind: 'home' };
  const tool = /^#\/tools\/([a-z0-9-]+)$/.exec(hash)?.[1];
  if (tool && ids.has(tool)) return { kind: 'tool', toolId: tool };
  const id = /^#\/results\/([a-z0-9-]+)$/.exec(hash)?.[1];
  return id ? { kind: 'result', id } : { kind: 'missing' };
}

export function pageRouteHash(route: PageRoute): string {
  if (route.kind === 'tool') return '#/tools/' + route.toolId;
  if (route.kind === 'result') return '#/results/' + route.id;
  return route.kind === 'missing' ? '#/not-found' : '#/';
}
