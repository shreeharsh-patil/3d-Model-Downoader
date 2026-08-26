import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { MESHY_CONSTANTS } from './constants';

export class MeshyProvider implements ModelProvider {
  readonly id = MESHY_CONSTANTS.ID;
  readonly label = MESHY_CONSTANTS.LABEL;
  readonly workspaceUrl = MESHY_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'meshy.ai' || host.endsWith('.meshy.ai');
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const match = url.match(MESHY_CONSTANTS.MODEL_ID_URL_PATTERN);
      if (match && match[1]) {
        return match[1];
      }
      // Fallback: derive model key from pathname
      const parsed = new URL(url);
      const dir = parsed.pathname.replace(/\/[^/]+$/, '');
      if (dir && dir !== '/') {
        return `${parsed.origin}${dir}`;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  isModelAsset(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        MESHY_CONSTANTS.MODEL_JSON_PATTERN.test(parsed.pathname) ||
        MESHY_CONSTANTS.MODEL_BINARY_PATTERN.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  }

  isBinaryAsset(url: string): boolean {
    try {
      const parsed = new URL(url);
      return MESHY_CONSTANTS.MODEL_BINARY_PATTERN.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  isTexture(url: string): boolean {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').pop() ?? '';
      return MESHY_CONSTANTS.TEXTURE_PATTERN.test(filename);
    } catch {
      return false;
    }
  }

  formatFilename(name?: string): string {
    return sanitizeFilename(name, this.id, 'glb');
  }
}

export const meshyProvider = new MeshyProvider();
