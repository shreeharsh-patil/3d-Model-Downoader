import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { RODIN_CONSTANTS } from './constants';

export class RodinProvider implements ModelProvider {
  readonly id = RODIN_CONSTANTS.ID;
  readonly label = RODIN_CONSTANTS.LABEL;
  readonly workspaceUrl = RODIN_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host.includes('hyperhuman.deemos.com') ||
        host.includes('hyperhuman.top') ||
        host.includes('hyper3d.ai') ||
        host.includes('deemos.com')
      );
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').pop() ?? '';
      const match = filename.match(RODIN_CONSTANTS.MODEL_ID_PATTERN);
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
        host.includes('deemos.com') ||
        host.includes('hyperhuman.top') ||
        host.includes('hyper3d.ai') ||
        host.includes('cloudfront.net') ||
        host.includes('amazonaws.com')
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

export const rodinProvider = new RodinProvider();
