export type WebsiteId = 'meshy' | 'tripo' | 'luma' | 'rodin' | 'sketchfab' | 'polypizza' | 'polyhaven';

export type ModelFormat = 'glb' | 'gltf';

export type ModelStatus =
  | 'detecting'
  | 'generating'
  | 'ready'
  | 'processing'
  | 'downloading'
  | 'complete'
  | 'error';

export interface ModelMetadata {
  meshCount?: number;
  primitiveCount?: number;
  vertexCount?: number;
  triangleCount?: number;
  materialCount?: number;
  textureCount?: number;
  animationCount?: number;
  skinCount?: number;
  hasMorphTargets?: boolean;
}

export interface DetectedModel {
  id?: string;
  provider: WebsiteId;
  name?: string;
  pageUrl: string;
  assetUrl?: string;
  format: ModelFormat;
  detectedAt: number;
  size?: number;
  status: ModelStatus;
  metadata?: ModelMetadata;
  previewUrl?: string;
  error?: string;
}

export interface TabModelState {
  tabId: number;
  provider?: WebsiteId;
  pageUrl?: string;
  modelId?: string;
  model?: DetectedModel;
  revision: number;
  updatedAt: number;
  status: ModelStatus;
  error?: string;
}

export type TextureFormat = 'default' | 'webp' | 'png' | 'jpg';

export type ExportFormat = 'glb' | 'stl' | 'obj' | 'usdz' | 'textures';

export interface DownloadHistoryItem {
  id: string;
  modelName: string;
  provider: WebsiteId;
  format?: ExportFormat;
  filename: string;
  timestamp: number;
  size?: number;
}

export interface DownloaderSettings {
  autoAskToDownload: boolean;
  textureFormat: TextureFormat;
  exportFormat: ExportFormat;
  showCompletionNotification: boolean;
  debugLogging: boolean;
  downloadHistory: DownloadHistoryItem[];
}

export interface GlbValidationResult {
  valid: boolean;
  reason?: string;
  byteLength: number;
  version?: number;
  metadata?: ModelMetadata;
}

export interface PageState {
  injected: boolean;
  hasDecodedGlb: boolean;
  hasActiveModel: boolean;
  activeModelUrl?: string;
  modelName?: string;
  previewUrl?: string;
  pendingDownload: boolean;
  lastGlbSize?: number;
  lastDownloadAt?: number;
  status: ModelStatus;
  metadata?: ModelMetadata;
}

export interface TabState {
  tabId?: number;
  url?: string;
  currentWebsiteId?: WebsiteId;
  currentWebsiteLabel?: string;
  isSupportedWebsite: boolean;
  isMeshy: boolean;
  shouldRedirect: boolean;
  model?: DetectedModel;
  previewUrl?: string;
  page?: PageState;
  status: ModelStatus;
  error?: string;
}
