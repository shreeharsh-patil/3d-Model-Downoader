import type { DetectedModel, WebsiteId } from '../types';

export interface ModelCandidate {
  id?: string;
  url: string;
  name?: string;
  pageUrl: string;
  capturedAt: number;
}

export interface ModelProvider {
  readonly id: WebsiteId;
  readonly label: string;
  readonly workspaceUrl: string;

  matchesUrl(url?: string): boolean;
  extractModelId(url: string): string | undefined;
  isModelAsset(url: string): boolean;
  isBinaryAsset?(url: string): boolean;
  formatFilename(name?: string): string;
}
