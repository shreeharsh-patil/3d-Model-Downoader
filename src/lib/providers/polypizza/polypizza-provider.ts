import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { POLYPIZZA_CONSTANTS } from './constants';

export class PolyPizzaProvider implements ModelProvider {
  readonly id = POLYPIZZA_CONSTANTS.ID;
  readonly label = POLYPIZZA_CONSTANTS.LABEL;
  readonly workspaceUrl = POLYPIZZA_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'poly.pizza' ||
        host.endsWith('.poly.pizza') ||
        host === 'polypizza.net' ||
        host.endsWith('.polypizza.net')
      );
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(POLYPIZZA_CONSTANTS.MODEL_ID_PATTERN);
      if (match && match[1]) {
        return match[1];
      }
      const filename = parsed.pathname.split('/').pop() ?? '';
      return filename.replace(/\.(glb|gltf|obj)$/i, '') || undefined;
    } catch {
      return undefined;
    }
  }

  isModelAsset(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      const is3d = pathname.endsWith('.glb') || pathname.includes('.glb') || pathname.endsWith('.obj') || pathname.endsWith('.gltf');
      if (!is3d) return false;

      const host = parsed.hostname.toLowerCase();
      return (
        host.includes('poly.pizza') ||
        host.includes('polypizza.net') ||
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
    return sanitizeFilename(name, this.id);
  }
}

export const polypizzaProvider = new PolyPizzaProvider();
