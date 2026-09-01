import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { mount, unmount } from 'svelte';
import Overlay from './Overlay.svelte';
import { executeDownload } from '../../src/lib/download-service';
import { validateGlb } from '../../src/lib/glb-validator';
import { logger } from '../../src/lib/logger';
import { BRIDGE_SOURCE, isMainWorldMessage } from '../../src/lib/messages';
import { findProvider } from '../../src/lib/providers/registry';
import { tripoProvider } from '../../src/lib/providers/tripo/tripo-provider';
import type { ModelProvider } from '../../src/lib/providers/provider.interface';
import type { DetectedModel, DownloaderSettings, ExportFormat, ModelMetadata, PageState } from '../../src/lib/types';

interface TripoActiveModel {
  url: string;
  modelKey: string;
  detectedAt: number;
  previewUrl?: string;
  metadata?: ModelMetadata;
}

function getActiveProvider(): ModelProvider {
  return findProvider(window.location.href) ?? tripoProvider;
}

let activeModel: TripoActiveModel | null = null;
let lastDownloadAt: number | undefined;
let modelGeneration = 0;
let pendingDownload = false;
let resourceObserver: PerformanceObserver | undefined;

const overlayConfig = {
  eventPrefix: 'model-downloader',
  get assetLabel() {
    return `${getActiveProvider().label} model`;
  },
  fileFormat: 'GLB',
};

function getModelKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.href);
    const dir = parsed.pathname.replace(/\/[^/]+$/, '');
    return `${parsed.origin}${dir}`;
  } catch {
    const noQuery = url.split('?')[0];
    return noQuery.replace(/\/[^/]+$/, '');
  }
}

function extractTripoModelName(): string | undefined {
  try {
    const heading = document.querySelector('h1, h2, [class*="model-name"], [class*="title"]');
    if (heading?.textContent && heading.textContent.trim().length > 0) {
      const text = heading.textContent.trim();
      if (text.length < 50 && !/tripo|workspace|studio|luma|rodin/i.test(text)) {
        return text;
      }
    }
    if (activeModel?.url) {
      return getActiveProvider().extractModelId(activeModel.url);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function extractTripoThumbnailUrl(): string | undefined {
  if (activeModel?.previewUrl) {
    return activeModel.previewUrl;
  }

  try {
    // 1. Look for rendered model preview or thumbnail images in the DOM
    const imgSelectors = [
      'img[src*="thumbnail"]',
      'img[src*="preview"]',
      'img[src*="render"]',
      'img[src*="cover"]',
      'img[src*="task"]',
      '[class*="active"] img',
      '[class*="preview"] img',
      '[class*="thumbnail"] img',
      'main img',
    ];

    for (const selector of imgSelectors) {
      const img = document.querySelector(selector) as HTMLImageElement | null;
      if (img?.src && img.src.startsWith('http') && !/avatar|logo|favicon|badge|icon/i.test(img.src)) {
        return img.src;
      }
    }

    // 2. Check OpenGraph image meta tag
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (ogImage && ogImage.startsWith('http') && !/default|logo/i.test(ogImage)) {
      return ogImage;
    }

    // 3. Fallback to 3D canvas snapshot
    const canvas = document.querySelector('main canvas, [class*="viewer"] canvas, canvas') as HTMLCanvasElement | null;
    if (canvas && canvas.width >= 64 && canvas.height >= 64) {
      try {
        const dataUrl = canvas.toDataURL('image/webp', 0.8);
        if (dataUrl && dataUrl.length > 500) {
          return dataUrl;
        }
      } catch {
        // canvas might be tainted or context not preserved
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

function scanExistingResources(): void {
  try {
    const entries = performance.getEntriesByType('resource');
    for (const entry of entries) {
      inspectResource(entry.name);
    }

    // Also scan DOM for model URLs in attributes or links
    if (!activeModel) {
      const elements = document.querySelectorAll('[src*=".glb"], [data-src*=".glb"], [href*=".glb"], [model-src*=".glb"]');
      for (const el of Array.from(elements)) {
        const src =
          el.getAttribute('src') ||
          el.getAttribute('data-src') ||
          el.getAttribute('model-src') ||
          el.getAttribute('href');
        if (src && getActiveProvider().isModelAsset(src)) {
          try {
            const absoluteUrl = new URL(src, window.location.href).href;
            inspectResource(absoluteUrl);
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

function getPageState(): PageState {
  if (!activeModel) {
    scanExistingResources();
  }

  return {
    injected: true,
    hasDecodedGlb: activeModel !== null,
    hasActiveModel: activeModel !== null,
    activeModelUrl: activeModel?.url,
    modelName: extractTripoModelName(),
    previewUrl: extractTripoThumbnailUrl(),
    pendingDownload,
    lastDownloadAt,
    status: activeModel ? 'ready' : 'detecting',
    metadata: activeModel?.metadata,
  };
}

function notifyOverlay(type: string, detail?: unknown) {
  window.dispatchEvent(
    new CustomEvent(`${overlayConfig.eventPrefix}:${type}`, {
      detail: {
        assetLabel: overlayConfig.assetLabel,
        fileFormat: overlayConfig.fileFormat,
        ...(detail && typeof detail === 'object' ? detail : {}),
      },
    }),
  );
}

async function syncWithBackground() {
  const provider = getActiveProvider();
  const modelName = extractTripoModelName();
  const previewUrl = extractTripoThumbnailUrl();
  const detectedModel: DetectedModel | undefined = activeModel
    ? {
        id: activeModel.modelKey,
        provider: provider.id,
        name: modelName,
        pageUrl: window.location.href,
        assetUrl: activeModel.url,
        format: 'glb',
        detectedAt: activeModel.detectedAt,
        status: 'ready',
        previewUrl,
        metadata: activeModel.metadata,
      }
    : undefined;

  try {
    const tabState = (await browser.runtime.sendMessage({ type: 'get-active-tab-state' })) as { tabId?: number };
    if (tabState?.tabId) {
      await browser.runtime.sendMessage({
        type: 'tab-model-updated',
        payload: {
          tabId: tabState.tabId,
          provider: provider.id,
          pageUrl: window.location.href,
          modelId: activeModel?.modelKey,
          model: detectedModel,
          revision: modelGeneration,
          updatedAt: Date.now(),
          status: activeModel ? 'ready' : 'detecting',
        },
      });
    }
  } catch {
    // ignore
  }
}

function handleTripoGlbUrlDetected(url: string, previewUrl?: string, capturedAt = Date.now()) {
  if (activeModel?.url === url) {
    if (previewUrl && !activeModel.previewUrl) {
      activeModel.previewUrl = previewUrl;
      void syncWithBackground();
    }
    return;
  }

  const modelKey = getModelKey(url) ?? url;
  modelGeneration += 1;
  activeModel = {
    url,
    modelKey,
    detectedAt: capturedAt,
    previewUrl: previewUrl ?? extractTripoThumbnailUrl(),
  };
  pendingDownload = false;

  logger.info(getActiveProvider().label, `Active ${getActiveProvider().label} model updated`, { modelKey, url });

  notifyOverlay('model-changed', {
    generation: modelGeneration,
    modelKey,
  });
  notifyOverlay('glb-ready', {
    generation: modelGeneration,
    modelKey,
  });

  void syncWithBackground();
}

function inspectResource(url: string) {
  if (getActiveProvider().isModelAsset(url)) {
    handleTripoGlbUrlDetected(url);
  }
}

function installResourceObserver() {
  try {
    scanExistingResources();

    resourceObserver = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        inspectResource(entry.name);
      }
    });

    resourceObserver.observe({ entryTypes: ['resource'] });
  } catch (error) {
    logger.warn('Tripo', 'Failed to initialize PerformanceObserver', error);
  }
}

async function downloadActiveModel(targetFormat?: ExportFormat) {
  if (!activeModel) {
    scanExistingResources();
  }

  const provider = getActiveProvider();
  if (!activeModel) {
    const errorMsg = `No ${provider.label} model is currently detected. Open or select a model first.`;
    notifyOverlay('download-error', {
      generation: modelGeneration,
      error: errorMsg,
    });
    return { ok: false, error: errorMsg };
  }

  pendingDownload = true;
  notifyOverlay('download-processing', {
    generation: modelGeneration,
    modelKey: activeModel.modelKey,
  });

  const modelName = extractTripoModelName();
  logger.info(provider.label, `Processing ${provider.label} GLB through background worker...`, activeModel.url);

  const result = (await browser.runtime.sendMessage({
    type: 'process-model-glb',
    url: activeModel.url,
    modelName,
    provider: provider.id,
  })) as {
    ok: boolean;
    error?: string;
    buffer?: ArrayBuffer;
    byteLength?: number;
    filename?: string;
  };

  pendingDownload = false;

  if (!result?.ok || !result.buffer) {
    const error = result?.error ?? `Failed to process ${provider.label} model.`;
    logger.error(provider.label, 'Processing failed', error);
    notifyOverlay('download-error', {
      generation: modelGeneration,
      modelKey: activeModel.modelKey,
      error,
    });
    return { ok: false, error };
  }

  let buffer: ArrayBuffer = result.buffer;

  // Optional texture transcoding if configured
  try {
    const settings = (await browser.runtime.sendMessage({ type: 'get-settings' })) as DownloaderSettings;
    if (settings?.textureFormat && settings.textureFormat !== 'default') {
      const { formatGlbTextures } = await import('../../src/lib/texture-format');
      buffer = await formatGlbTextures(buffer, settings.textureFormat);
    }
  } catch (error) {
    logger.warn(provider.label, 'Texture formatting failed, downloading original textures', error);
  }

  let requestedFormat = targetFormat;
  if (!requestedFormat) {
    try {
      const settings = (await browser.runtime.sendMessage({ type: 'get-settings' })) as DownloaderSettings;
      requestedFormat = settings?.exportFormat ?? 'glb';
    } catch {
      requestedFormat = 'glb';
    }
  }

  const validation = validateGlb(buffer);
  if (validation.metadata && activeModel) {
    activeModel.metadata = validation.metadata;
  }

  try {
    const finalFilename = result.filename ?? provider.formatFilename(modelName);
    const downloadRes = await executeDownload(buffer, {
      filename: finalFilename,
      modelName,
      provider: provider.id,
      exportFormat: requestedFormat,
      skipValidation: false,
    });

    lastDownloadAt = Date.now();
    notifyOverlay('download-started', {
      byteLength: downloadRes.size,
      generation: modelGeneration,
      modelKey: activeModel.modelKey,
    });

    void syncWithBackground();
    return { ok: true, byteLength: downloadRes.size };
  } catch (error) {
    logger.error(provider.label, 'Download failed', error);
    notifyOverlay('download-error', {
      generation: modelGeneration,
      modelKey: activeModel.modelKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default defineContentScript({
  matches: [
    'https://*.tripo3d.ai/*',
    'https://tripo3d.ai/*',
    'https://*.tripo3d.com/*',
    'https://tripo3d.com/*',
    'https://*.lumalabs.ai/*',
    'https://lumalabs.ai/*',
    'https://*.hyperhuman.top/*',
    'https://*.deemos.com/*',
    'https://*.hyper3d.ai/*',
  ],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    installResourceObserver();

    // Listen for messages from MAIN world Tripo hook
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isMainWorldMessage(data)) return;

      if (data.type === 'tripo-glb-url-detected') {
        const payload = data.payload as { url?: string; previewUrl?: string; capturedAt?: number };
        if (payload?.url) {
          handleTripoGlbUrlDetected(payload.url, payload.previewUrl, payload.capturedAt);
        }
      } else if (data.type === 'tripo-preview-detected') {
        const payload = data.payload as { previewUrl?: string };
        if (payload?.previewUrl && activeModel) {
          activeModel.previewUrl = payload.previewUrl;
          void syncWithBackground();
        }
      } else if (data.type === 'route-changed') {
        scanExistingResources();
        void syncWithBackground();
      }
    });

    // Listen for SPA navigation
    window.addEventListener('popstate', () => {
      logger.debug('Tripo', 'SPA route changed');
      scanExistingResources();
      void syncWithBackground();
    });

    window.addEventListener('focus', () => {
      scanExistingResources();
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'tripo-downloader-overlay',
      position: 'overlay',
      anchor: () => document.body ?? document.documentElement,
      onMount: (container) => {
        return mount(Overlay, {
          target: container,
          props: overlayConfig,
        });
      },
      onRemove: (app) => {
        if (app) unmount(app);
        resourceObserver?.disconnect();
      },
    });

    ui.mount();

    window.addEventListener(`${overlayConfig.eventPrefix}:user-choice`, (event) => {
      const choice = (event as CustomEvent).detail;
      if (choice === 'yes') void downloadActiveModel();
      if (choice === 'no') pendingDownload = false;
    });

    browser.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'get-page-state') {
        return Promise.resolve(getPageState());
      }

      if (message.type === 'download-last-mesh') {
        return downloadActiveModel(message.exportFormat);
      }
    });
  },
});
