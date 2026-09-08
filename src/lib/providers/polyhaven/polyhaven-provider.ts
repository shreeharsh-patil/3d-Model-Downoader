import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { POLYHAVEN_CONSTANTS } from './constants';

export class PolyHavenProvider implements ModelProvider {
  readonly id = POLYHAVEN_CONSTANTS.ID;
  readonly label = POLYHAVEN_CONSTANTS.LABEL;
  readonly workspaceUrl = POLYHAVEN_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'polyhaven.com' ||
        host.endsWith('.polyhaven.com') ||
        host === 'polyhaven.org' ||
        host.endsWith('.polyhaven.org')
      );
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(POLYHAVEN_CONSTANTS.MODEL_ID_PATTERN);
      if (match && match[1]) {
        return match[1];
      }
      const filename = parsed.pathname.split('/').pop() ?? '';
      return filename.replace(/\.(glb|gltf|fbx|blend)$/i, '') || undefined;
    } catch {
      return undefined;
    }
  }

  isModelAsset(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      const is3d = pathname.endsWith('.glb') || pathname.includes('.glb') || pathname.endsWith('.gltf');
      if (!is3d) return false;

      const host = parsed.hostname.toLowerCase();
      return (
        host.includes('polyhaven.com') ||
        host.includes('polyhaven.org') ||
        host.includes('dl.polyhaven.org') ||
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
    return sanitizeFilename(name, this.id);
  }
}

export const polyhavenProvider = new PolyHavenProvider();
