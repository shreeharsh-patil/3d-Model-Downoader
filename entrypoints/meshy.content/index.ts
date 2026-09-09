import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { mount, unmount } from 'svelte';
import Overlay from './Overlay.svelte';
import { executeDownload } from '../../src/lib/download-service';
import { DownloadJobController } from '../../src/lib/download-job';
import { validateGlb } from '../../src/lib/glb-validator';
import { logger } from '../../src/lib/logger';
import { normalizeQuantizedPositionsInGlb } from '../../src/lib/meshy/gltf-normalizer';
import { getMeshyPageModelHint, isMeshyModelKeyCorrelatedWithPage } from '../../src/lib/meshy/model-correlation';
import { getModelKey, meshyModelStore } from '../../src/lib/meshy/model-state';
import { extractMeshyModelName, extractMeshyThumbnailUrl } from '../../src/lib/meshy/page-context';
import { embedTextureInGlb, fetchTexturePng, glbHasEmbeddedTextures } from '../../src/lib/meshy/texture-embedder';
import { BRIDGE_SOURCE, CONTENT_SOURCE, isMainWorldMessage } from '../../src/lib/messages';
import { meshyProvider } from '../../src/lib/providers/meshy/meshy-provider';
import type { CapturedModelAsset, DetectedModel, DownloadJob, DownloaderSettings, ExportFormat, ModelMetadata, PageState } from '../../src/lib/types';

let injected = false;
let lastDownloadAt: number | undefined;
let activeAbortController: AbortController | null = null;
const jobs = new DownloadJobController();
let queuedFormat: ExportFormat | undefined;

const overlayConfig = {
  eventPrefix: 'model-downloader',
  assetLabel: 'model',
  fileFormat: 'GLB',
};

function isCorrelatedWithPage(modelKey: string, url = window.location.href): boolean {
  return isMeshyModelKeyCorrelatedWithPage(modelKey, url);
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

function getPageState(): PageState {
  const current = meshyModelStore.current;
  return {
    injected,
    hasDecodedGlb: current !== null,
    hasActiveModel: meshyModelStore.candidate !== null,
    modelName: extractMeshyModelName(),
    previewUrl: extractMeshyThumbnailUrl(),
    pendingDownload: jobs.current?.status === 'queued',
    lastGlbSize: current?.byteLength,
    lastDownloadAt,
    status: current ? 'ready' : 'detecting',
    metadata: current?.metadata,
    activeModelKey: meshyModelStore.currentModelKey,
    generation: meshyModelStore.currentGeneration,
    job: jobs.current ?? undefined,
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
        metadata: current.metadata,
      }
    : undefined;

  try {
    await browser.runtime.sendMessage({
      type: 'tab-model-updated',
      payload: {
        tabId: 0,
        provider: 'meshy',
        pageUrl: window.location.href,
        modelId: current?.modelKey,
        model: detectedModel,
        revision: meshyModelStore.currentGeneration,
        updatedAt: Date.now(),
        status: current ? 'ready' : 'detecting',
      },
    });
  } catch {
    // ignore
  }
}

async function downloadModelWithTextureFallback(
  asset: CapturedModelAsset,
  job: DownloadJob,
  targetFormat?: ExportFormat,
) {
  // Cancel previous download/processing if still active
  if (activeAbortController) {
    activeAbortController.abort();
  }
  const abortController = new AbortController();
  activeAbortController = abortController;

  notifyOverlay('download-processing', {
    generation: job.generation,
    modelKey: job.modelKey,
  });
  jobs.transition(job, 'processing');

  let downloadBufferValue = asset.buffer;

  if (glbHasEmbeddedTextures(asset.buffer)) {
    logger.debug('Meshy', 'GLB already contains embedded textures');
  } else {
    const textureUrls = meshyModelStore.getTextureUrls(job.modelKey);
    // The legacy single-texture fallback is only unambiguous for one material.
    if (textureUrls.length === 1 && (asset.metadata?.materialCount ?? 0) <= 1) {
      try {
        const texturePng = await fetchTexturePng(textureUrls[0]);
        if (abortController.signal.aborted || !jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) return;

        const embedded = embedTextureInGlb(asset.buffer, texturePng);
        if (embedded) {
          downloadBufferValue = embedded;
          logger.info('Meshy', 'Texture successfully embedded into GLB');
        }
      } catch (error) {
        logger.warn('Meshy', 'Texture embedding skipped due to error', error);
      }
    } else if (textureUrls.length > 0) {
      logger.warn('Meshy', 'External textures were preserved separately because material association is ambiguous.');
    }
  }

  if (abortController.signal.aborted || !jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) return;

  // Optional texture format transcoding if configured
  try {
    const settings = (await browser.runtime.sendMessage({ type: 'get-settings' })) as DownloaderSettings;
    if (settings?.textureFormat && settings.textureFormat !== 'default') {
      const { formatGlbTextures } = await import('../../src/lib/texture-format');
      if (!abortController.signal.aborted) {
        downloadBufferValue = await formatGlbTextures(downloadBufferValue, settings.textureFormat, settings.textureQuality);
      }
    }
  } catch (error) {
    logger.warn('Meshy', 'Texture formatting failed, downloading original textures', error);
  }

  if (abortController.signal.aborted || !jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) return;

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
    jobs.transition(job, 'validating');
    if (!jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) return;
    jobs.transition(job, 'downloading');
    const res = await executeDownload(downloadBufferValue, {
      filename,
      modelName,
      provider: 'meshy',
      exportFormat: requestedFormat,
      skipValidation: false,
    });

    lastDownloadAt = Date.now();
    jobs.transition(job, 'completed');
    notifyOverlay('download-started', {
      byteLength: res.size,
      generation: job.generation,
      modelKey: job.modelKey,
    });
  } catch (error) {
    jobs.transition(job, 'error', error instanceof Error ? error.message : String(error));
    logger.error('Meshy', 'Download failed', error);
    notifyOverlay('download-error', {
      error: error instanceof Error ? error.message : String(error),
      generation: job.generation,
      modelKey: job.modelKey,
    });
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null;
    }
  }
}

function startModelDownload(targetFormat?: ExportFormat): { ok: boolean; queued?: boolean; byteLength?: number; error?: string } {
  const current = meshyModelStore.current;
  const candidate = meshyModelStore.candidate;
  if (!candidate) {
    notifyOverlay('download-error', { error: 'No active Meshy model is detected yet.' });
    return { ok: false, error: 'No active Meshy model is detected yet.' };
  }
  const job = jobs.begin('meshy', candidate.modelKey, candidate.generation, candidate.binaryUrl);
  if (!job) return { ok: false, error: 'A model download is already in progress.' };
  queuedFormat = targetFormat;
  if (!current || current.modelKey !== job.modelKey || current.generation !== job.generation) {
    notifyOverlay('download-pending', {
      generation: job.generation,
      modelKey: job.modelKey,
    });
    window.postMessage({ source: CONTENT_SOURCE, type: 'request-model-buffer', modelKey: job.modelKey }, window.location.origin);
    window.setTimeout(() => {
      if (job.status !== 'queued' || !jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) return;
      const error = 'The model was detected, but its decoded GLB is unavailable. Open the model in Meshy’s viewer and use its Export/Download action, then retry. If the extension was just reloaded, refresh this page first.';
      jobs.transition(job, 'error', error);
      notifyOverlay('download-error', { error, generation: job.generation, modelKey: job.modelKey });
    }, 30000);
    return { ok: true, queued: true };
  }

  void downloadModelWithTextureFallback(current, job, targetFormat);
  return { ok: true, byteLength: current.byteLength };
}

function handleGlbReady(buffer: ArrayBuffer, modelKey: string, sourceUrl?: string, capturedAt = Date.now()) {
  if (!isCorrelatedWithPage(modelKey)) {
    logger.debug('Meshy', 'Ignored decoded GLB that is not correlated with the selected route.', { modelKey });
    return;
  }
  const validation = validateGlb(buffer);
  if (!validation.valid) {
    logger.warn('Meshy', 'Ignored invalid GLB from worker', validation.reason);
    const job = jobs.current;
    if (job?.status === 'queued' && job.modelKey === modelKey && jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) {
      const error = validation.reason || 'The decoded model is not a valid GLB.';
      jobs.transition(job, 'error', error);
      notifyOverlay('download-error', { error, generation: job.generation, modelKey });
    }
    return;
  }

  let normalizedBuffer = buffer;
  try {
    normalizedBuffer = normalizeQuantizedPositionsInGlb(buffer);
  } catch (error) {
    logger.warn('Meshy', 'Normalization failed; preserving the validated original GLB.', error);
  }
  const normalizedValidation = validateGlb(normalizedBuffer);
  if (!normalizedValidation.valid) {
    logger.warn('Meshy', 'Normalization produced invalid output; preserving the validated original.', normalizedValidation.reason);
  }
  const acceptedBuffer = normalizedValidation.valid ? normalizedBuffer : buffer;
  const metadata = normalizedValidation.valid ? normalizedValidation.metadata : validation.metadata;
  const cached = meshyModelStore.acceptDecodedGlb(acceptedBuffer, modelKey, sourceUrl, capturedAt, metadata);
  if (!cached) {
    logger.debug('Meshy', 'Cached late GLB without activating it', { modelKey });
    return;
  }
  logger.info('Meshy', `GLB ready for model ${modelKey} (${cached.byteLength} bytes)`);

  notifyOverlay('glb-ready', {
    byteLength: cached.byteLength,
    generation: cached.generation,
    modelKey,
  });

  void syncWithBackground();

  const job = jobs.current;
  if (job?.status === 'queued' && jobs.isCurrent(job, cached.modelKey, cached.generation)) {
    void downloadModelWithTextureFallback(cached, job, queuedFormat);
  }
}

function handleModelJsonDetected(url: string | undefined, explicitModelKey?: string, capturedAt = Date.now()) {
  const modelKey = explicitModelKey ?? getModelKey(url);
  if (!modelKey || !isCorrelatedWithPage(modelKey)) return;
  const { isNew, candidate } = meshyModelStore.activateCandidate({ provider: 'meshy', modelKey, jsonUrl: url, detectedAt: capturedAt });
  const generation = candidate.generation;

  logger.debug('Meshy', 'model.json detected', { url, modelKey, isNew });

  if (isNew) {
    jobs.cancel();
    activeAbortController?.abort();
    notifyOverlay('model-changed', {
      generation,
      modelKey,
    });
  }

  const cached = meshyModelStore.current;
  if (cached) {
    notifyOverlay('glb-ready', {
      byteLength: cached.byteLength,
      generation,
      modelKey,
      cached: true,
    });
    void syncWithBackground();

  }
}

function handleModelBinaryDetected(url: string | undefined, explicitModelKey?: string, capturedAt = Date.now()) {
  const modelKey = explicitModelKey ?? getModelKey(url);
  if (!modelKey || !isCorrelatedWithPage(modelKey)) return;

  logger.debug('Meshy', 'model.meshy binary URL detected', { modelKey, url });

  if (meshyModelStore.currentModelKey !== modelKey) {
    jobs.cancel();
    activeAbortController?.abort();
  }
  meshyModelStore.noteBinary(modelKey, url ?? modelKey, capturedAt);
  void syncWithBackground();
}

function handleTextureDetected(url?: string, explicitModelKey?: string) {
  if (!url) return;
  const modelKey = explicitModelKey ?? getModelKey(url);
  if (!modelKey || modelKey !== meshyModelStore.currentModelKey) return;
  meshyModelStore.addTextureUrl(modelKey, url);
  logger.debug('Meshy', 'texture URL detected', url);
}

function handleRouteChange(url?: string) {
  logger.debug('Meshy', 'SPA Route changed', url);
  // Only an explicit, different model id proves that the captured asset is
  // stale. Meshy also updates generic workspace routes while a model is open.
  const newModelId = getMeshyPageModelHint(url || window.location.href);
  const currentKey = meshyModelStore.currentModelKey;

  if (currentKey && newModelId && !currentKey.toLowerCase().includes(newModelId)) {
    meshyModelStore.resetCurrentModel();
    jobs.cancel();
    activeAbortController?.abort();
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
      jobs.cancel('Cancelled by user.');
      break;
    case 'never':
      jobs.cancel('Cancelled by user.');
      await browser.runtime.sendMessage({ type: 'set-never-show-again', value: true });
      notifyOverlay('preference-saved');
      break;
  }
}

export default defineContentScript({
  matches: ['https://meshy.ai/*', 'https://*.meshy.ai/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Listen for messages from MAIN world hook
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isMainWorldMessage(data)) return;

      switch (data.type) {
        case 'model-buffer-error': {
          const payload = data.payload as { modelKey?: string; error?: string };
          const job = jobs.current;
          if (job?.status === 'queued' && payload.modelKey === job.modelKey && jobs.isCurrent(job, meshyModelStore.currentModelKey, meshyModelStore.currentGeneration)) {
            const error = payload.error || 'Unable to retrieve the model.';
            jobs.transition(job, 'error', error);
            notifyOverlay('download-error', { error, generation: job.generation, modelKey: job.modelKey });
          }
          break;
        }
        case 'installed':
          injected = true;
          notifyOverlay('injected');
          break;
        case 'route-changed':
          handleRouteChange((data.payload as { url?: string })?.url);
          break;
        case 'model-binary-detected':
          { const p = data.payload as { url?: string; modelKey?: string; capturedAt?: number }; handleModelBinaryDetected(p?.url, p?.modelKey, p?.capturedAt); }
          break;
        case 'model-json-detected':
          { const p = data.payload as { url?: string; modelKey?: string; capturedAt?: number }; handleModelJsonDetected(p?.url, p?.modelKey, p?.capturedAt); }
          break;
        case 'texture-detected':
          { const p = data.payload as { url?: string; modelKey?: string }; handleTextureDetected(p?.url, p?.modelKey); }
          break;
        case 'glb-ready': {
          const payload = data.payload as { data?: ArrayBuffer; byteLength?: number; url?: string; modelKey?: string; capturedAt?: number };
          if (payload?.data instanceof ArrayBuffer && payload.modelKey) {
            handleGlbReady(payload.data, payload.modelKey, payload.url, payload.capturedAt);
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
        activeAbortController?.abort();
        jobs.reset();
        meshyModelStore.dispose();
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
        return Promise.resolve(startModelDownload(message.exportFormat));
      }
    });
  },
});
