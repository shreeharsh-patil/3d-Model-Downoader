import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { SKETCHFAB_CONSTANTS } from './constants';

export class SketchfabProvider implements ModelProvider {
  readonly id = SKETCHFAB_CONSTANTS.ID;
  readonly label = SKETCHFAB_CONSTANTS.LABEL;
  readonly workspaceUrl = SKETCHFAB_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === 'sketchfab.com' || host.endsWith('.sketchfab.com');
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(SKETCHFAB_CONSTANTS.MODEL_ID_PATTERN);
      if (match) {
        return match[1] || match[2];
      }
      const hexMatch = parsed.pathname.match(/([a-f0-9]{32})/i);
      if (hexMatch) {
        return hexMatch[1];
      }
      const slug = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
      return slug.replace(/\.(glb|gltf|bin|zip)$/i, '') || undefined;
    } catch {
      return undefined;
    }
  }

  isModelAsset(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      const host = parsed.hostname.toLowerCase();

      const is3dAsset =
        pathname.endsWith('.glb') ||
        pathname.includes('.glb') ||
        pathname.endsWith('.gltf') ||
        pathname.includes('file.osgjs') ||
        pathname.includes('model_file.bin') ||
        (pathname.includes('/models/') && (pathname.includes('/download') || pathname.includes('archive')));

      if (!is3dAsset) return false;

      return (
        host.includes('sketchfab.com') ||
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

export const sketchfabProvider = new SketchfabProvider();
