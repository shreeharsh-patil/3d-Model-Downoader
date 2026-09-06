import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { LUMA_CONSTANTS } from './constants';

export class LumaProvider implements ModelProvider {
  readonly id = LUMA_CONSTANTS.ID;
  readonly label = LUMA_CONSTANTS.LABEL;
  readonly workspaceUrl = LUMA_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'lumalabs.ai' || host.endsWith('.lumalabs.ai');
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').pop() ?? '';
      const match = filename.match(LUMA_CONSTANTS.MODEL_ID_PATTERN);
      if (match && match[1]) {
        return match[1];
      }
      return filename.replace(/\.glb$/i, '') || undefined;
    } catch {
      return undefined;
    }
  }

  isModelAsset(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();

      // Must be a .glb asset
      const isGlb = pathname.endsWith('.glb') || pathname.includes('.glb');
      if (!isGlb) return false;

      const host = parsed.hostname.toLowerCase();
      return (
        host.includes('lumalabs.ai') ||
        host.includes('lumalabs.com') ||
        host.includes('storage.googleapis.com') ||
        host.includes('cloudfront.net')
      );
    } catch {
      return false;
    }
  }

  isBinaryAsset(url: string): boolean {
    return this.isModelAsset(url);
  }

  formatFilename(name?: string): string {
    return sanitizeFilename(name, this.id, 'glb');
  }
}

export const lumaProvider = new LumaProvider();
