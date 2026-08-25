import { findProvider, isSupportedUrl } from './providers/registry';
import type { WebsiteId } from './types';

export { BRIDGE_SOURCE, CONTENT_SOURCE } from './messages';
export type { WebsiteId } from './types';

export function isSupportedWebsiteUrl(url?: string): boolean {
  return isSupportedUrl(url);
}

export function findWebsiteState(url?: string) {
  const provider = findProvider(url);
  if (!provider) return undefined;
  return {
    id: provider.id,
    label: provider.label,
    workspaceUrl: provider.workspaceUrl,
    overlay: {
      eventPrefix: 'model-downloader',
      assetLabel: provider.id === 'meshy' ? 'model' : `${provider.label} model`,
      fileFormat: 'GLB',
    },
    matchesUrl: (u?: string) => provider.matchesUrl(u),
  };
}
