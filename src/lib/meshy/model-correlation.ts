/**
 * Returns a model id only when the page URL actually identifies a model.
 * Generic workspace routes deliberately return undefined: the active model is
 * then determined from the model asset currently requested by Meshy's viewer.
 */
export const NON_MODEL_SEGMENTS = new Set([
  'generate',
  'create',
  'history',
  'recent',
  'library',
  'gallery',
  'editor',
  'showcase',
  'preview',
  'explore',
  'new',
  'edit',
  'draft',
  'tasks',
  'assets',
  'view',
  'feed',
  'all',
  'community',
  'dashboard',
  'workspace',
  'home',
  'text-to-3d',
  'image-to-3d',
  'remesh',
  'text-to-texture',
]);

export function getMeshyPageModelHint(url: string, baseUrl = 'https://www.meshy.ai/'): string | undefined {
  try {
    const parsed = new URL(url, baseUrl);

    for (const key of ['taskId', 'task_id', 'modelId', 'model_id', 'id']) {
      const value = parsed.searchParams.get(key);
      if (value && /^[a-z0-9_-]{8,}$/i.test(value) && !NON_MODEL_SEGMENTS.has(value.toLowerCase())) {
        return value.toLowerCase();
      }
    }

    const routeMatch = parsed.pathname.match(
      /\/workspace\/(?:(?:text|image)-to-3d|remesh)\/([a-z0-9_-]+)/i,
    );
    if (routeMatch?.[1]) {
      const segment = routeMatch[1].toLowerCase();
      if (!NON_MODEL_SEGMENTS.has(segment)) return segment;
    }

    const pathOrHash = `${parsed.pathname}/${parsed.hash}`;
    const hashMatch = pathOrHash.match(/(?:^|[/=])([a-z0-9_-]{16,})(?:[/&?#]|$)/i)?.[1]?.toLowerCase();
    if (hashMatch && !NON_MODEL_SEGMENTS.has(hashMatch)) return hashMatch;
  } catch {
    return undefined;
  }
}

/**
 * A generic workspace URL has no useful correlation id, so rejecting every
 * asset there makes downloads impossible. Only enforce correlation when the
 * route explicitly names a model.
 */
export function isMeshyModelKeyCorrelatedWithPage(modelKey: string, pageUrl: string): boolean {
  const hint = getMeshyPageModelHint(pageUrl);
  return !hint || modelKey.toLowerCase().includes(hint);
}
