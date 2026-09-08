import { browser } from '#imports';
import type { DownloaderSettings, DownloadHistoryItem, TextureFormat } from './types';

const SETTINGS_KEY = 'model-downloader-settings';
const LEGACY_SETTINGS_KEY = 'meshy-downloader-settings';
const MAX_HISTORY_ITEMS = 20;

export const DEFAULT_SETTINGS: DownloaderSettings = {
  autoAskToDownload: true,
  textureFormat: 'default',
  textureQuality: 0.92,
  exportFormat: 'glb',
  showCompletionNotification: false,
  debugLogging: false,
  downloadHistory: [],
};

let writeQueue: Promise<unknown> = Promise.resolve();

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getSettings(): Promise<DownloaderSettings> {
  try {
    const result = await browser.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    const stored = (result[SETTINGS_KEY] || result[LEGACY_SETTINGS_KEY]) as Partial<DownloaderSettings> | undefined;
    const rawQuality = stored?.textureQuality;
    const textureQuality = typeof rawQuality === 'number'
      ? Math.min(1, Math.max(0.1, rawQuality > 1 ? rawQuality / 100 : rawQuality))
      : DEFAULT_SETTINGS.textureQuality;
    return {
      ...DEFAULT_SETTINGS,
      ...(stored ?? {}),
      textureQuality,
      downloadHistory: Array.isArray(stored?.downloadHistory) ? stored.downloadHistory : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function updateSettings(patch: Partial<DownloaderSettings>): Promise<DownloaderSettings> {
  return serializeWrite(async () => {
    const current = await getSettings();
    const updated: DownloaderSettings = {
      ...current,
      ...patch,
      textureQuality: Math.min(1, Math.max(0.1, patch.textureQuality ?? current.textureQuality)),
    };
    await browser.storage.local.set({ [SETTINGS_KEY]: updated });
    return updated;
  });
}

export async function addDownloadToHistory(
  item: Omit<DownloadHistoryItem, 'id' | 'timestamp'>,
): Promise<DownloadHistoryItem[]> {
  return serializeWrite(async () => {
    const settings = await getSettings();
    const newItem: DownloadHistoryItem = {
      id: `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
      modelName: item.modelName,
      provider: item.provider,
      format: item.format ?? 'glb',
      filename: item.filename,
      size: item.size,
    };
    const nextHistory = [newItem, ...settings.downloadHistory].slice(0, MAX_HISTORY_ITEMS);
    await browser.storage.local.set({ [SETTINGS_KEY]: { ...settings, downloadHistory: nextHistory } });
    return nextHistory;
  });
}

export async function clearDownloadHistory(): Promise<void> {
  await updateSettings({ downloadHistory: [] });
}

// Backward compatibility helpers for existing code
export async function getState(): Promise<{
  neverShowAgain: boolean;
  textureFormat: TextureFormat;
  downloadCount: number;
}> {
  const settings = await getSettings();
  return {
    neverShowAgain: !settings.autoAskToDownload,
    textureFormat: settings.textureFormat,
    downloadCount: settings.downloadHistory.length,
  };
}

export async function setState(patch: {
  neverShowAgain?: boolean;
  textureFormat?: TextureFormat;
}): Promise<void> {
  const updates: Partial<DownloaderSettings> = {};
  if (patch.neverShowAgain !== undefined) {
    updates.autoAskToDownload = !patch.neverShowAgain;
  }
  if (patch.textureFormat !== undefined) {
    updates.textureFormat = patch.textureFormat;
  }
  await updateSettings(updates);
}

export async function resetState(): Promise<void> {
  await serializeWrite(() => browser.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS } }));
}
