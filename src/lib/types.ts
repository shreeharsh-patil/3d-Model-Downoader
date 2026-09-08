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

export type DownloadJobStatus =
  | 'idle'
  | 'detecting'
  | 'ready'
  | 'queued'
  | 'processing'
  | 'validating'
  | 'downloading'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface ModelCandidate {
  provider: WebsiteId;
  modelKey: string;
  generation: number;
  jsonUrl?: string;
  binaryUrl?: string;
  detectedAt: number;
}

export interface CapturedModelAsset {
  provider: WebsiteId;
  modelKey: string;
  generation: number;
  capturedAt: number;
  sourceUrl?: string;
  bufferStatus: 'pending' | 'ready' | 'invalid' | 'released';
  buffer: ArrayBuffer;
  byteLength: number;
}

export interface DownloadJob {
  id: string;
  provider: WebsiteId;
  modelKey: string;
  generation: number;
  sourceUrl?: string;
  startedAt: number;
  status: DownloadJobStatus;
  error?: string;
}

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
  textureQuality: number;
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
  activeModelKey?: string;
  generation?: number;
  job?: DownloadJob;
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
