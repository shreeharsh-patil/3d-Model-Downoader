import { sanitizeFilename } from '../../filename';
import type { ModelProvider } from '../provider.interface';
import { TRIPO_CONSTANTS } from './constants';

export class TripoProvider implements ModelProvider {
  readonly id = TRIPO_CONSTANTS.ID;
  readonly label = TRIPO_CONSTANTS.LABEL;
  readonly workspaceUrl = TRIPO_CONSTANTS.WORKSPACE_URL;

  matchesUrl(url?: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        host === 'tripo3d.ai' ||
        host.endsWith('.tripo3d.ai') ||
        host === 'tripo3d.com' ||
        host.endsWith('.tripo3d.com')
      );
    } catch {
      return false;
    }
  }

  extractModelId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').pop() ?? '';
      const match = filename.match(TRIPO_CONSTANTS.MODEL_ID_PATTERN);
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
      const filename = pathname.split('/').pop() ?? '';

      // Must be a .glb asset
      const isGlb = pathname.endsWith('.glb') || pathname.includes('.glb');
      if (!isGlb) return false;

      const host = parsed.hostname.toLowerCase();
      // Recognized Tripo data servers and domains
      const isTripoDomain =
        host.includes('tripo3d.com') ||
        host.includes('tripo3d.ai') ||
        host.includes('tripo-data');
      const isKnownStorage = host.includes('amazonaws.com') || host.includes('cloudfront.net');
      const hasTripoInPath = pathname.includes('tripo');

      return isTripoDomain || (isKnownStorage && hasTripoInPath) || filename.includes('model');
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

export const tripoProvider = new TripoProvider();
