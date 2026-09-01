import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { mount, unmount } from 'svelte';
import Overlay from './Overlay.svelte';
import { executeDownload } from '../../src/lib/download-service';
import { InvalidGlbError } from '../../src/lib/errors';
import { validateGlb } from '../../src/lib/glb-validator';
import { logger } from '../../src/lib/logger';
import { normalizeQuantizedPositionsInGlb } from '../../src/lib/meshy/gltf-normalizer';
import { getModelKey, meshyModelStore } from '../../src/lib/meshy/model-state';
import { extractMeshyModelName, extractMeshyThumbnailUrl } from '../../src/lib/meshy/page-context';
import { embedTextureInGlb, fetchTexturePng, glbHasEmbeddedTextures } from '../../src/lib/meshy/texture-embedder';
import { BRIDGE_SOURCE, CONTENT_SOURCE, isMainWorldMessage } from '../../src/lib/messages';
import { meshyProvider } from '../../src/lib/providers/meshy/meshy-provider';
import type { DetectedModel, DownloaderSettings, ExportFormat, ModelMetadata, PageState } from '../../src/lib/types';

let injected = false;
let pendingDownload = false;
let lastDownloadAt: number | undefined;
let activeAbortController: AbortController | null = null;
let currentMetadata: ModelMetadata | undefined;

const overlayConfig = {
  eventPrefix: 'model-downloader',
  assetLabel: 'model',
  fileFormat: 'GLB',
};

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

function getPageState(): PageState {
  const current = meshyModelStore.current;
  return {
    injected,
    hasDecodedGlb: current !== null,
    hasActiveModel: current !== null,
    modelName: extractMeshyModelName(),
    previewUrl: extractMeshyThumbnailUrl(),
    pendingDownload,
    lastGlbSize: current?.byteLength,
    lastDownloadAt,
    status: current ? 'ready' : 'detecting',
    metadata: currentMetadata,
  };
}

async function syncWithBackground() {
  const current = meshyModelStore.current;
  const modelName = extractMeshyModelName();
  const previewUrl = extractMeshyThumbnailUrl();

  const detectedModel: DetectedModel | undefined = current
    ? {
        id: current.modelKey,
        provider: 'meshy',
        name: modelName,
        pageUrl: window.location.href,
        format: 'glb',
        detectedAt: Date.now(),
        size: current.byteLength,
        status: 'ready',
        previewUrl,
        metadata: currentMetadata,
      }
    : undefined;

  try {
    const tabState = (await browser.runtime.sendMessage({ type: 'get-active-tab-state' })) as { tabId?: number };
    if (tabState?.tabId) {
      await browser.runtime.sendMessage({
        type: 'tab-model-updated',
        payload: {
          tabId: tabState.tabId,
          provider: 'meshy',
          pageUrl: window.location.href,
          modelId: current?.modelKey,
          model: detectedModel,
          revision: meshyModelStore.currentGeneration,
          updatedAt: Date.now(),
          status: current ? 'ready' : 'detecting',
        },
      });
    }
  } catch {
    // ignore
  }
}

async function downloadModelWithTextureFallback(
  glbBuffer: ArrayBuffer,
  modelKey: string,
  targetFormat?: ExportFormat,
) {
  // Cancel previous download/processing if still active
  if (activeAbortController) {
    activeAbortController.abort();
  }
  const abortController = new AbortController();
  activeAbortController = abortController;

  notifyOverlay('download-processing', {
    generation: meshyModelStore.currentGeneration,
    modelKey,
  });

  let downloadBufferValue = glbBuffer;

  if (glbHasEmbeddedTextures(glbBuffer)) {
    logger.debug('Meshy', 'GLB already contains embedded textures');
  } else {
    const textureUrl = meshyModelStore.getTextureUrl(modelKey);
    if (textureUrl) {
      logger.info('Meshy', 'Embedding external texture into GLB...', textureUrl);
      try {
        const texturePng = await fetchTexturePng(textureUrl);
        if (abortController.signal.aborted) return;

        const embedded = embedTextureInGlb(glbBuffer, texturePng);
        if (embedded) {
          downloadBufferValue = embedded;
          logger.info('Meshy', 'Texture successfully embedded into GLB');
        }
      } catch (error) {
        logger.warn('Meshy', 'Texture embedding skipped due to error', error);
      }
    }
  }

  if (abortController.signal.aborted) return;

  // Optional texture format transcoding if configured
  try {
    const settings = (await browser.runtime.sendMessage({ type: 'get-settings' })) as DownloaderSettings;
    if (settings?.textureFormat && settings.textureFormat !== 'default') {
      const { formatGlbTextures } = await import('../../src/lib/texture-format');
      if (!abortController.signal.aborted) {
        downloadBufferValue = await formatGlbTextures(downloadBufferValue, settings.textureFormat);
      }
    }
  } catch (error) {
    logger.warn('Meshy', 'Texture formatting failed, downloading original textures', error);
  }

  if (abortController.signal.aborted) return;

  let requestedFormat = targetFormat;
  if (!requestedFormat) {
    try {
      const settings = (await browser.runtime.sendMessage({ type: 'get-settings' })) as DownloaderSettings;
      requestedFormat = settings?.exportFormat ?? 'glb';
    } catch {
      requestedFormat = 'glb';
    }
  }

  const modelName = extractMeshyModelName();
  const filename = meshyProvider.formatFilename(modelName);

  try {
    const res = await executeDownload(downloadBufferValue, {
      filename,
      modelName,
      provider: 'meshy',
      exportFormat: requestedFormat,
      skipValidation: false,
    });

    lastDownloadAt = Date.now();
    notifyOverlay('download-started', {
      byteLength: res.size,
      generation: meshyModelStore.currentGeneration,
      modelKey,
    });
  } catch (error) {
    logger.error('Meshy', 'Download failed', error);
    notifyOverlay('download-error', {
      error: error instanceof Error ? error.message : String(error),
      generation: meshyModelStore.currentGeneration,
      modelKey,
    });
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null;
    }
  }
}

function startModelDownload(targetFormat?: ExportFormat) {
  const current = meshyModelStore.current;
  if (!current) {
    pendingDownload = true;
    notifyOverlay('download-pending', {
      generation: meshyModelStore.currentGeneration,
      modelKey: meshyModelStore.currentModelKey,
    });
    return;
  }

  pendingDownload = false;
  void downloadModelWithTextureFallback(current.buffer, current.modelKey, targetFormat);
}

function handleGlbReady(buffer: ArrayBuffer, sourceUrl?: string) {
  const validation = validateGlb(buffer);
  if (!validation.valid) {
    logger.warn('Meshy', 'Ignored invalid GLB from worker', validation.reason);
    return;
  }

  currentMetadata = validation.metadata;
  const normalizedBuffer = normalizeQuantizedPositionsInGlb(buffer);
  const modelKey = getModelKey(sourceUrl) ?? meshyModelStore.currentModelKey ?? `meshy-${Date.now()}`;

  const cached = meshyModelStore.setCurrentGlb(normalizedBuffer, modelKey, sourceUrl);
  logger.info('Meshy', `GLB ready for model ${modelKey} (${cached.byteLength} bytes)`);

  notifyOverlay('glb-ready', {
    byteLength: cached.byteLength,
    generation: cached.generation,
    modelKey,
  });

  void syncWithBackground();

  if (pendingDownload) {
    pendingDownload = false;
    startModelDownload();
  }
}

function handleModelJsonDetected(url?: string) {
  const modelKey = getModelKey(url);
  const { isNew, generation } = meshyModelStore.setJsonModelKey(modelKey);

  logger.debug('Meshy', 'model.json detected', { url, modelKey, isNew });

  if (isNew) {
    pendingDownload = false;
    currentMetadata = undefined;
    notifyOverlay('model-changed', {
      generation,
      modelKey,
    });
  }

  if (!modelKey) return;

  const cached = meshyModelStore.getCachedGlb(modelKey);
  if (cached) {
    const glb = meshyModelStore.setCurrentGlb(cached.buffer, modelKey);
    notifyOverlay('glb-ready', {
      byteLength: glb.byteLength,
      generation,
      modelKey,
      cached: true,
    });
    void syncWithBackground();

    if (pendingDownload) {
      pendingDownload = false;
      startModelDownload();
    }
  }
}

function handleModelBinaryDetected(url?: string) {
  const modelKey = getModelKey(url);
  if (!modelKey) return;

  logger.debug('Meshy', 'model.meshy binary URL detected', { modelKey, url });

  const cached = meshyModelStore.getCachedGlb(modelKey);
  if (cached && (!meshyModelStore.current || meshyModelStore.current.modelKey !== modelKey)) {
    meshyModelStore.setCurrentGlb(cached.buffer, modelKey);
    logger.debug('Meshy', 'Restored cached GLB from binary URL', { modelKey });
    void syncWithBackground();
  }
}

function handleTextureDetected(url?: string) {
  if (!url) return;
  meshyModelStore.addTextureUrl(url);
  logger.debug('Meshy', 'texture URL detected', url);
}

function handleRouteChange(url?: string) {
  logger.debug('Meshy', 'SPA Route changed', url);
  // If navigating to a different model route, reset current model
  const newModelId = meshyProvider.extractModelId(url || window.location.href);
  const currentKey = meshyModelStore.currentModelKey;

  if (newModelId && currentKey && !currentKey.includes(newModelId)) {
    meshyModelStore.resetCurrentModel();
    notifyOverlay('model-changed', {
      generation: meshyModelStore.currentGeneration,
    });
    void syncWithBackground();
  }
}

async function handleUserChoice(choice: 'yes' | 'no' | 'never') {
  switch (choice) {
    case 'yes':
      startModelDownload();
      break;
    case 'no':
      pendingDownload = false;
      break;
    case 'never':
      pendingDownload = false;
      await browser.runtime.sendMessage({ type: 'set-never-show-again', value: true });
      notifyOverlay('preference-saved');
      break;
  }
}

export default defineContentScript({
  matches: ['https://www.meshy.ai/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Listen for messages from MAIN world hook
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isMainWorldMessage(data)) return;

      switch (data.type) {
        case 'installed':
          injected = true;
          notifyOverlay('injected');
          break;
        case 'route-changed':
          handleRouteChange((data.payload as { url?: string })?.url);
          break;
        case 'model-binary-detected':
          handleModelBinaryDetected((data.payload as { url?: string })?.url);
          break;
        case 'model-json-detected':
          handleModelJsonDetected((data.payload as { url?: string })?.url);
          break;
        case 'texture-detected':
          handleTextureDetected((data.payload as { url?: string })?.url);
          break;
        case 'glb-ready': {
          const payload = data.payload as { data?: ArrayBuffer; byteLength?: number; url?: string };
          if (payload?.data instanceof ArrayBuffer) {
            handleGlbReady(payload.data, payload.url);
          }
          break;
        }
      }
    });

    // Request status from main world hook
    window.postMessage({ source: CONTENT_SOURCE, type: 'status-request' }, window.location.origin);

    // Mount Shadow DOM Overlay UI
    const ui = await createShadowRootUi(ctx, {
      name: 'meshy-downloader-overlay',
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
      },
    });

    ui.mount();

    window.addEventListener(`${overlayConfig.eventPrefix}:user-choice`, (event) => {
      const choice = (event as CustomEvent).detail;
      void handleUserChoice(choice);
    });

    // Handle messages from popup / background
    browser.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'get-page-state') {
        return Promise.resolve(getPageState());
      }

      if (message.type === 'download-last-mesh') {
        const current = meshyModelStore.current;
        if (!current) {
          return Promise.resolve({
            ok: false,
            error: 'No decoded GLB is currently buffered. Open or select a model first.',
          });
        }
        startModelDownload(message.exportFormat);
        return Promise.resolve({ ok: true, byteLength: current.byteLength });
      }
    });
  },
});
