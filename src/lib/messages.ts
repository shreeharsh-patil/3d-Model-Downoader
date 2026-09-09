import type {
  DetectedModel,
  DownloaderSettings,
  DownloadHistoryItem,
  GlbValidationResult,
  ModelMetadata,
  TabModelState,
  TabState,
} from './types';

export const BRIDGE_SOURCE = '3d-model-downloader-main-world';
export const CONTENT_SOURCE = '3d-model-downloader-content-script';

export type MainWorldBridgeEvent =
  | {
      type: 'installed';
      payload: { at: number; url: string };
    }
  | {
      type: 'model-json-detected';
      payload: { url: string; pageUrl: string; capturedAt: number; modelKey: string; detectionId: string };
    }
  | {
      type: 'model-binary-detected';
      payload: { url: string; pageUrl: string; capturedAt: number; modelKey: string; detectionId: string };
    }
  | {
      type: 'texture-detected';
      payload: { url: string; pageUrl: string; capturedAt: number; modelKey?: string };
    }
  | {
      type: 'glb-ready';
      payload: { data: ArrayBuffer; byteLength: number; url?: string; capturedAt: number; modelKey: string; detectionId: string };
    }
  | {
      type: 'status-request';
      payload?: Record<string, unknown>;
    };

export function isMainWorldMessage(data: unknown): data is { source: string; type: string; payload?: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: string }).source === BRIDGE_SOURCE &&
    typeof (data as { type?: string }).type === 'string'
  );
}

export type ExtensionMessage =
  | { type: 'get-active-tab-state'; refresh?: boolean }
  | { type: 'refresh-active-tab' }
  | { type: 'get-state' }
  | { type: 'get-settings' }
  | { type: 'set-never-show-again'; value: boolean }
  | { type: 'set-texture-format'; value: string }
  | { type: 'set-export-format'; value: string }
  | { type: 'update-settings'; settings: Partial<DownloaderSettings> }
  | { type: 'get-download-history' }
  | { type: 'clear-download-history' }
  | { type: 'record-download'; item: Omit<DownloadHistoryItem, 'id' | 'timestamp'> }
  | { type: 'download-active-tab-mesh'; exportFormat?: import('./types').ExportFormat }
  | { type: 'download-last-mesh'; exportFormat?: import('./types').ExportFormat }
  | { type: 'get-page-state'; refresh?: boolean }
  | { type: 'refresh-detection' }
  | { type: 'open-workspace' }
  | { type: 'model-detected'; payload: { model: DetectedModel; revision: number } }
  | { type: 'process-tripo-glb'; url: string; modelName?: string; provider?: import('./types').WebsiteId }
  | { type: 'process-model-glb'; url: string; modelName?: string; provider?: import('./types').WebsiteId }
  | { type: 'tab-model-updated'; payload: TabModelState }
  | { type: 'trigger-download'; bufferBase64?: string; url?: string; filename: string; mimeType?: string }
  | { type: 'get-transfer-chunk'; transferId: string; chunkIndex: number };

export type ExtensionResponse =
  | { ok: true; data?: unknown; byteLength?: number }
  | { ok: false; error: string };

export function isExtensionMessage(msg: unknown): msg is ExtensionMessage {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type?: string }).type === 'string';
}
