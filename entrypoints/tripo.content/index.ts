import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { mount, unmount } from 'svelte';
import Overlay from './Overlay.svelte';
import { executeDownload } from '../../src/lib/download-service';
import { decodeModelBuffer } from '../../src/lib/binary-message';
import { DownloadJobController } from '../../src/lib/download-job';
import { validateGlb } from '../../src/lib/glb-validator';
import { logger } from '../../src/lib/logger';
import { BRIDGE_SOURCE, isMainWorldMessage } from '../../src/lib/messages';
import { findProvider } from '../../src/lib/providers/registry';
import { tripoProvider } from '../../src/lib/providers/tripo/tripo-provider';
import { TripoModelStore, type TripoDetectionSource } from '../../src/lib/providers/tripo/model-state';
import type { ModelProvider } from '../../src/lib/providers/provider.interface';
import type { DetectedModel, DownloaderSettings, ExportFormat, ModelMetadata, PageState } from '../../src/lib/types';

function getActiveProvider(): ModelProvider {
  return findProvider(window.location.href) ?? tripoProvider;
}

let lastDownloadAt: number | undefined;
let resourceObserver: PerformanceObserver | undefined;
const jobs = new DownloadJobController();
const tripoModelStore = new TripoModelStore();

const overlayConfig = {
  eventPrefix: 'model-downloader',
  get assetLabel() {
    return `${getActiveProvider().label} model`;
  },
  fileFormat: 'GLB',
};

function extractTripoModelName(): string | undefined {
  try {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (ogTitle) {
      const clean = ogTitle.split(/[-–|]/)[0].trim();
      if (clean.length > 0 && clean.length < 80 && !/tripo|workspace|studio|luma|rodin|sketchfab|poly/i.test(clean)) {
        return clean;
      }
    }

    const heading = document.querySelector('h1, h2, [class*="model-name"], [class*="title"]');
    if (heading?.textContent && heading.textContent.trim().length > 0) {
      const text = heading.textContent.trim();
      if (text.length < 80 && !/tripo|workspace|studio|luma|rodin|sketchfab|poly/i.test(text)) {
        return text;
      }
    }
    if (tripoModelStore.active?.url) {
      return getActiveProvider().extractModelId(tripoModelStore.active.url);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function extractTripoThumbnailUrl(): string | undefined {
  if (tripoModelStore.active?.previewUrl) {
    return tripoModelStore.active.previewUrl;
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
    if (!tripoModelStore.active) {
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
            inspectResource(absoluteUrl, 'dom');
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
  const activeModel = tripoModelStore.active;
  if (!activeModel) {
    scanExistingResources();
  }

  const current = tripoModelStore.active;

  return {
    injected: true,
    hasDecodedGlb: current !== null,
    hasActiveModel: current !== null,
    activeModelUrl: current?.url,
    modelName: extractTripoModelName(),
    previewUrl: extractTripoThumbnailUrl(),
    pendingDownload: jobs.current?.status === 'queued',
    lastDownloadAt,
    status: current ? 'ready' : 'detecting',
    metadata: current?.metadata,
    activeModelKey: current?.modelKey,
    generation: tripoModelStore.generation,
    job: jobs.current ?? undefined,
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
  const activeModel = tripoModelStore.active;
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
    await browser.runtime.sendMessage({
      type: 'tab-model-updated',
      payload: {
        tabId: 0,
        provider: provider.id,
        pageUrl: window.location.href,
        modelId: activeModel?.modelKey,
        model: detectedModel,
        revision: tripoModelStore.generation,
        updatedAt: Date.now(),
        status: activeModel ? 'ready' : 'detecting',
      },
    });
  } catch {
    // ignore
  }
}

function handleTripoGlbUrlDetected(url: string, previewUrl?: string, capturedAt = Date.now(), source: TripoDetectionSource = 'network') {
  const pageHint = getActiveProvider().extractModelId(window.location.href);
  const result = tripoModelStore.consider({
    url,
    detectedAt: capturedAt,
    previewUrl,
    source,
  }, pageHint);
  if (!result?.activated) return;
  const { candidate } = result;

  if (!result.changed) {
    if (previewUrl) void syncWithBackground();
    return;
  }
  jobs.cancel();

  logger.info(getActiveProvider().label, `Active ${getActiveProvider().label} model updated`, { modelKey: candidate.modelKey, url });

  notifyOverlay('model-changed', {
    generation: tripoModelStore.generation,
    modelKey: candidate.modelKey,
  });
  notifyOverlay('glb-ready', {
    generation: tripoModelStore.generation,
    modelKey: candidate.modelKey,
  });

  void syncWithBackground();
}

function inspectResource(url: string, source: TripoDetectionSource = 'performance') {
  if (getActiveProvider().isModelAsset(url)) {
    handleTripoGlbUrlDetected(url, undefined, Date.now(), source);
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
  if (!tripoModelStore.active) {
    scanExistingResources();
  }

  const provider = getActiveProvider();
  const activeModel = tripoModelStore.active;
  if (!activeModel) {
    const errorMsg = `No ${provider.label} model is currently detected. Open or select a model first.`;
    notifyOverlay('download-error', {
      generation: tripoModelStore.generation,
      error: errorMsg,
    });
    return { ok: false, error: errorMsg };
  }

  const generation = tripoModelStore.generation;
  const job = jobs.begin(provider.id, activeModel.modelKey, generation, activeModel.url);
  if (!job) return { ok: false, error: 'A model download is already in progress.' };
  notifyOverlay('download-processing', {
    generation,
    modelKey: activeModel.modelKey,
  });

  const modelName = extractTripoModelName();
  logger.info(provider.label, `Processing ${provider.label} GLB through background worker...`, activeModel.url);
  jobs.transition(job, 'processing');

  try {
    const result = (await browser.runtime.sendMessage({
      type: 'process-model-glb',
      url: activeModel.url,
      modelName,
      provider: provider.id,
    })) as {
      ok: boolean;
      error?: string;
      bufferBase64?: string;
      byteLength?: number;
      filename?: string;
    };

    if (!jobs.isCurrent(job, tripoModelStore.active?.modelKey, tripoModelStore.generation)) {
      return { ok: false, error: 'Model selection changed during download.' };
    }
    if (!result?.ok || !result.bufferBase64) throw new Error(result?.error ?? `Failed to process ${provider.label} model.`);

    let buffer = decodeModelBuffer(result.bufferBase64);
    let settings: DownloaderSettings | undefined;
    try {
      settings = (await browser.runtime.sendMessage({ type: 'get-settings' })) as DownloaderSettings;
      if (settings?.textureFormat && settings.textureFormat !== 'default') {
        const { formatGlbTextures } = await import('../../src/lib/texture-format');
        buffer = await formatGlbTextures(buffer, settings.textureFormat, settings.textureQuality);
      }
    } catch (error) {
      logger.warn(provider.label, 'Texture formatting failed, downloading original textures', error);
    }

    if (!jobs.isCurrent(job, tripoModelStore.active?.modelKey, tripoModelStore.generation)) {
      return { ok: false, error: 'Model selection changed during download.' };
    }

    const requestedFormat = targetFormat ?? settings?.exportFormat ?? 'glb';
    jobs.transition(job, 'validating');
    const validation = validateGlb(buffer);
    if (!validation.valid) throw new Error(validation.reason ?? 'Processed model is not a valid GLB.');
    if (validation.metadata) tripoModelStore.updateMetadata(job.modelKey, job.generation, validation.metadata);
    jobs.transition(job, 'downloading');

    const finalFilename = result.filename ?? provider.formatFilename(modelName);
    const downloadRes = await executeDownload(buffer, {
      filename: finalFilename,
      modelName,
      provider: provider.id,
      exportFormat: requestedFormat,
      skipValidation: true,
    });

    if (!jobs.isCurrent(job, tripoModelStore.active?.modelKey, tripoModelStore.generation)) {
      return { ok: false, error: 'Model selection changed during download.' };
    }
    jobs.transition(job, 'completed');
    lastDownloadAt = Date.now();
    notifyOverlay('download-started', {
      byteLength: downloadRes.size,
      generation,
      modelKey: activeModel.modelKey,
    });

    void syncWithBackground();
    return { ok: true, byteLength: downloadRes.size };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    jobs.transition(job, 'error', message);
    logger.error(provider.label, 'Download failed', error);
    notifyOverlay('download-error', {
      generation,
      modelKey: activeModel.modelKey,
      error: message,
    });
    return { ok: false, error: message };
  }
}

export default defineContentScript({
  matches: [
    'https://studio.tripo3d.ai/*',
    'https://*.tripo3d.ai/*',
    'https://tripo3d.ai/*',
    'https://*.tripo3d.com/*',
    'https://tripo3d.com/*',
    'https://*.lumalabs.ai/*',
    'https://lumalabs.ai/*',
    'https://*.hyperhuman.top/*',
    'https://*.deemos.com/*',
    'https://*.hyper3d.ai/*',
    'https://*.sketchfab.com/*',
    'https://sketchfab.com/*',
    'https://*.poly.pizza/*',
    'https://poly.pizza/*',
    'https://*.polypizza.net/*',
    'https://*.polyhaven.com/*',
    'https://polyhaven.com/*',
    'https://*.polyhaven.org/*',
    'https://polyhaven.org/*',
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
        const payload = data.payload as { url?: string; previewUrl?: string; capturedAt?: number; source?: TripoDetectionSource };
        if (payload?.url) {
          handleTripoGlbUrlDetected(payload.url, payload.previewUrl, payload.capturedAt, payload.source);
        }
      } else if (data.type === 'tripo-preview-detected') {
        const payload = data.payload as { previewUrl?: string };
        const activeModel = tripoModelStore.active;
        if (payload?.previewUrl && activeModel) {
          tripoModelStore.consider({ ...activeModel, previewUrl: payload.previewUrl }, getActiveProvider().extractModelId(window.location.href));
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
      if (choice === 'no') jobs.cancel('Cancelled by user.');
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
