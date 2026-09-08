import { browser, defineBackground } from '#imports';
import { InvalidGlbError, UnsupportedProviderError } from '../src/lib/errors';
import { logger } from '../src/lib/logger';
import { isExtensionMessage } from '../src/lib/messages';
import { findProvider } from '../src/lib/providers/registry';
import {
  clearDownloadHistory,
  getSettings,
  getState,
  setState,
  updateSettings,
} from '../src/lib/storage';
import { tabStateManager } from '../src/lib/tab-state';
import { processTripoGlb } from '../src/lib/tripo-processing';
import type { PageState, TabState, TextureFormat } from '../src/lib/types';

async function getActiveTab() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  } catch {
    return undefined;
  }
}

async function getActiveTabState(): Promise<TabState> {
  const tab = await getActiveTab();
  const tabId = tab?.id;
  const url = tab?.url;
  const provider = findProvider(url);

  const baseState: TabState = {
    tabId,
    url,
    currentWebsiteId: provider?.id,
    currentWebsiteLabel: provider?.label,
    isSupportedWebsite: provider !== undefined,
    isMeshy: provider?.id === 'meshy',
    shouldRedirect: provider === undefined,
    status: provider ? 'detecting' : 'ready',
  };

  if (!tabId || !provider) {
    return baseState;
  }

  // Get or init isolated tab state
  const tabModel = tabStateManager.getOrCreate(tabId, url);
  baseState.model = tabModel.model;
  baseState.status = tabModel.status;
  baseState.error = tabModel.error;

  // Query content script for latest page state
  try {
    const pageState = (await browser.tabs.sendMessage(tabId, { type: 'get-page-state' })) as PageState;
    baseState.page = pageState;
    if (pageState.status) {
      baseState.status = pageState.status;
    }
    if (pageState.previewUrl) {
      baseState.previewUrl = pageState.previewUrl;
      if (baseState.model) {
        baseState.model.previewUrl = pageState.previewUrl;
      }
    }
  } catch {
    logger.debug('Background', `Content script not yet ready on tab ${tabId}`);
  }

  if (!baseState.previewUrl && baseState.model?.previewUrl) {
    baseState.previewUrl = baseState.model.previewUrl;
  }

  return baseState;
}

export default defineBackground(() => {
  logger.info('Background', 'PolyFetch 3D background service worker initialized');

  // Clean up tab state when tabs close
  browser.tabs.onRemoved?.addListener((tabId) => {
    tabStateManager.remove(tabId);
  });

  // Invalidate stale model state when tabs navigate
  browser.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      tabStateManager.onUrlChange(tabId, changeInfo.url);
    }
  });

  browser.runtime.onMessage.addListener((rawMessage, sender) => {
    if (!isExtensionMessage(rawMessage)) return;

    const message = rawMessage;

    if (message.type === 'get-state') {
      return getState();
    }

    if (message.type === 'get-settings') {
      return getSettings();
    }

    if (message.type === 'update-settings') {
      return updateSettings(message.settings);
    }

    if (message.type === 'set-never-show-again') {
      return setState({ neverShowAgain: Boolean(message.value) });
    }

    if (message.type === 'set-texture-format') {
      const allowedFormats: TextureFormat[] = ['default', 'webp', 'png', 'jpg'];
      const textureFormat = allowedFormats.includes(message.value as TextureFormat)
        ? (message.value as TextureFormat)
        : 'default';
      return setState({ textureFormat });
    }

    if (message.type === 'set-export-format') {
      const allowed: import('../src/lib/types').ExportFormat[] = ['glb', 'stl', 'obj', 'usdz', 'textures'];
      const exportFormat = allowed.includes(message.value as import('../src/lib/types').ExportFormat)
        ? (message.value as import('../src/lib/types').ExportFormat)
        : 'glb';
      return updateSettings({ exportFormat });
    }

    if (message.type === 'get-download-history') {
      return getSettings().then((s) => s.downloadHistory);
    }

    if (message.type === 'clear-download-history') {
      return clearDownloadHistory().then(() => ({ ok: true }));
    }

    if (message.type === 'open-workspace') {
      const provider = findProvider(sender.tab?.url);
      return browser.tabs.create({
        url: provider?.workspaceUrl ?? 'https://www.meshy.ai/workspace',
      });
    }

    if (message.type === 'get-active-tab-state') {
      return getActiveTabState();
    }

    if (message.type === 'tab-model-updated') {
      const { tabId, model, revision } = message.payload;
      if (tabId && model) {
        tabStateManager.updateModel(tabId, model, revision);
      }
      return Promise.resolve({ ok: true });
    }

    if (message.type === 'process-tripo-glb' || message.type === 'process-model-glb') {
      const url = typeof message.url === 'string' ? message.url : undefined;
      const provider = message.provider || 'tripo';
      if (!url) {
        return Promise.resolve({ ok: false, error: 'No model GLB URL was provided.' });
      }

      return processTripoGlb(url, message.modelName, provider)
        .then((result) => ({
          ok: true,
          buffer: result.buffer,
          byteLength: result.byteLength,
          filename: result.filename,
          validation: result.validation,
        }))
        .catch((error) => {
          logger.error('Background', 'Tripo processing failed', error);
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        });
    }

    if (message.type === 'download-active-tab-mesh') {
      const exportFormat = message.exportFormat;
      return getActiveTab().then(async (tab) => {
        if (!tab?.id || !tab.url) {
          return { ok: false, error: 'No active tab found.' };
        }
        const provider = findProvider(tab.url);
        if (!provider) {
          return { ok: false, error: 'Active tab is not a supported 3D generation website.' };
        }

        try {
          return await browser.tabs.sendMessage(tab.id, {
            type: 'download-last-mesh',
            exportFormat,
          });
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    }
  });
});
