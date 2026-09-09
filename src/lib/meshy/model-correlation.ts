/**
 * Returns a model id only when the page URL actually identifies a model.
 * Generic workspace routes deliberately return undefined: the active model is
 * then determined from the model asset currently requested by Meshy's viewer.
 */
export function getMeshyPageModelHint(url: string, baseUrl = 'https://www.meshy.ai/'): string | undefined {
  try {
    const parsed = new URL(url, baseUrl);

    for (const key of ['taskId', 'task_id', 'modelId', 'model_id', 'id']) {
      const value = parsed.searchParams.get(key);
      if (value && /^[a-z0-9_-]{8,}$/i.test(value)) return value.toLowerCase();
    }

    const routeMatch = parsed.pathname.match(
      /\/workspace\/(?:(?:text|image)-to-3d|remesh)\/([a-z0-9_-]+)/i,
    );
    if (routeMatch?.[1]) return routeMatch[1].toLowerCase();

    const pathOrHash = `${parsed.pathname}/${parsed.hash}`;
    return pathOrHash.match(/(?:^|[/=])([a-z0-9_-]{16,})(?:[/&?#]|$)/i)?.[1]?.toLowerCase();
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
