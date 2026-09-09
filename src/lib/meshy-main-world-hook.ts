import { BRIDGE_SOURCE, CONTENT_SOURCE } from './messages';
import { meshyProvider } from './providers/meshy/meshy-provider';

const INSTALLED_KEY = '__3d_model_downloader_installed__';

type DetectionRecord = {
  id: string;
  modelKey: string;
  binaryUrl?: string;
  detectedAt: number;
};

type WorkerRequestRecord = {
  candidate: DetectionRecord;
  correlationId?: string;
};

function getCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['requestId', 'messageId', 'jobId', 'id']) {
    const id = record[key];
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  return undefined;
}

function looksLikeGlb(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new Uint8Array(buffer, 0, 4);
  return view[0] === 0x67 && view[1] === 0x6c && view[2] === 0x54 && view[3] === 0x46; // "glTF"
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer)) return null;
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

export function findDecodedGlb(value: unknown, seen = new Set<object>(), depth = 0): ArrayBuffer | null {
  const raw = toArrayBuffer(value);
  if (raw) return looksLikeGlb(raw) ? raw : null;
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return null;
  seen.add(value);
  for (const child of Object.values(value)) {
    const buffer = findDecodedGlb(child, seen, depth + 1);
    if (buffer) return buffer;
  }
  return null;
}

function getUrlString(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return undefined;
}

function resolveUrl(input: unknown): string | undefined {
  const value = getUrlString(input);
  if (!value) return undefined;
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return undefined;
  }
}

const MESHY_ASSET_MARKER = /(?:\.(?:glb|meshy)(?:[?#]|$)|\/(?:model|mesh|animation|rigged|motion|rig)\.(?:json|meshy|glb)(?:[?#]|$)|\/texture_[^/?#]+\.png(?:[?#]|$))/i;

export function findMeshyAssetUrlsInObject(value: unknown, baseUrl: string, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (!MESHY_ASSET_MARKER.test(value)) return found;
    try {
      const resolved = new URL(value, baseUrl);
      if (/^https?:$/.test(resolved.protocol) && !found.includes(resolved.href)) found.push(resolved.href);
    } catch {
      // ignore malformed URLs in API payloads
    }
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    findMeshyAssetUrlsInObject(item, baseUrl, found);
  }
  return found;
}

export function installMeshyMainWorldHook() {
  const w = window as typeof window & Record<string, unknown>;
  if (w[INSTALLED_KEY]) {
    postToContent('installed', { at: Date.now(), url: window.location.href });
    return;
  }
  w[INSTALLED_KEY] = true;
  let detectionSequence = 0;
  let latestCandidate: DetectionRecord | undefined;
  let lastDecoded: { buffer: ArrayBuffer; candidate: DetectionRecord } | undefined;
  let lastDecodedMesh: { buffer: ArrayBuffer; candidate: DetectionRecord } | undefined;
  let lastDecodedAnim: { buffer: ArrayBuffer; candidate: DetectionRecord } | undefined;
  const workerRequests = new WeakMap<Worker, WorkerRequestRecord[]>();

  function inspectGlbContent(buffer: ArrayBuffer): { hasMeshes: boolean; hasAnimations: boolean; isMotionClip: boolean } {
    try {
      if (buffer.byteLength < 20) return { hasMeshes: false, hasAnimations: false, isMotionClip: false };
      const view = new DataView(buffer);
      const jsonLen = view.getUint32(12, true);
      if (jsonLen > 0 && jsonLen <= buffer.byteLength - 20) {
        const slice = new Uint8Array(buffer, 20, Math.min(jsonLen, 8192));
        const text = new TextDecoder().decode(slice);
        const hasAnimations = /"animations"\s*:\s*\[\s*\{/u.test(text) || text.includes('"animations":');
        const hasMeshes = /"meshes"\s*:\s*\[\s*\{/u.test(text) || text.includes('"meshes":');
        const isDummyMannequin = text.includes('meshData') || text.includes('dummy') || text.includes('Armature_mesh');
        const isMotionClip = hasAnimations && (buffer.byteLength < 350 * 1024 || isDummyMannequin || !hasMeshes);
        return {
          hasMeshes: hasMeshes && !isDummyMannequin,
          hasAnimations,
          isMotionClip,
        };
      }
    } catch {
      // ignore
    }
    return { hasMeshes: true, hasAnimations: false, isMotionClip: false };
  }

  function recordWorkerRequest(worker: Worker, message: unknown) {
    if (!latestCandidate) return;
    // Initialization messages have no model output and must not occupy the
    // FIFO slot later used by a decode response without a request id.
    const type = (message as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && /^(init|initialize|load|ready|authorize|auth)$/i.test(type)) return;
    const queue = workerRequests.get(worker) ?? [];
    queue.push({ candidate: { ...latestCandidate }, correlationId: getCorrelationId(message) });
    if (queue.length > 32) queue.splice(0, queue.length - 32);
    workerRequests.set(worker, queue);
  }

  function takeWorkerCandidate(worker: Worker, message: unknown): DetectionRecord | undefined {
    const queue = workerRequests.get(worker);
    if (!queue?.length) return latestCandidate;
    const responseId = getCorrelationId(message);
    const index = responseId ? queue.findIndex((item) => item.correlationId === responseId) : 0;
    if (index < 0) return undefined;
    return queue.splice(index, 1)[0]?.candidate;
  }

  function modelKeyFromAssetUrl(url: string): string | undefined {
    try {
      const parsed = new URL(url, window.location.href);
      const directory = parsed.pathname.replace(/\/[^/]+$/, '');
      return directory && directory !== '/' ? `${parsed.origin}${directory}` : undefined;
    } catch {
      return undefined;
    }
  }

  function recordDetection(url: string, binary: boolean): DetectionRecord | undefined {
    const modelKey = modelKeyFromAssetUrl(url);
    if (!modelKey) return undefined;
    if (latestCandidate?.modelKey === modelKey) {
      if (binary) latestCandidate.binaryUrl = url;
      latestCandidate.detectedAt = Date.now();
      return latestCandidate;
    }
    latestCandidate = {
      id: `meshy-${Date.now()}-${++detectionSequence}`,
      modelKey,
      binaryUrl: binary ? url : undefined,
      detectedAt: Date.now(),
    };
    return latestCandidate;
  }

  function postToContent(type: string, payload: Record<string, unknown>, transfer?: Transferable[]) {
    // Retain copies for a content script that started after the decode event.
    if (type === 'glb-ready' && payload.data instanceof ArrayBuffer) {
      const candidateToSave: DetectionRecord = (payload.modelKey && latestCandidate && latestCandidate.modelKey === payload.modelKey)
        ? { ...latestCandidate }
        : {
            id: String(payload.detectionId || `meshy-${Date.now()}`),
            modelKey: String(payload.modelKey || window.location.href.split('?')[0].split('#')[0]),
            binaryUrl: typeof payload.url === 'string' ? payload.url : undefined,
            detectedAt: Number(payload.capturedAt || Date.now()),
          };
      const record = { buffer: payload.data.slice(0), candidate: candidateToSave };
      lastDecoded = record;
      const { hasMeshes, hasAnimations, isMotionClip } = inspectGlbContent(payload.data);
      if (isMotionClip || hasAnimations) {
        lastDecodedAnim = record;
      }
      if (hasMeshes && !isMotionClip) {
        lastDecodedMesh = record;
      }
    }
    try {
      window.postMessage(
        { source: BRIDGE_SOURCE, type, payload },
        '*',
        transfer,
      );
    } catch {
      // ignore
    }
  }

  function notifyRouteChanged() {
    postToContent('route-changed', { url: window.location.href, at: Date.now() });
  }

  // SPA navigation hooks
  if (typeof history !== 'undefined') {
    const nativePushState = history.pushState;
    if (nativePushState) {
      history.pushState = function (...args) {
        const res = nativePushState.apply(this, args);
        notifyRouteChanged();
        return res;
      };
    }

    const nativeReplaceState = history.replaceState;
    if (nativeReplaceState) {
      history.replaceState = function (...args) {
        const res = nativeReplaceState.apply(this, args);
        notifyRouteChanged();
        return res;
      };
    }
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('popstate', notifyRouteChanged);
  }

  // Hook Web Workers to capture decoded GLBs (model.meshy deobfuscation result)
  const NativeWorker = window.Worker;
  const inspectedWorkers = new WeakSet<Worker>();

  function inspectWorkerMessage(worker: Worker, data: unknown) {
    const raw = findDecodedGlb(data);
    if (!raw) return;
    const candidate = takeWorkerCandidate(worker, data) ?? latestCandidate ?? {
      id: `meshy-worker-${Date.now()}-${++detectionSequence}`,
      modelKey: window.location.href.split('?')[0].split('#')[0],
      detectedAt: Date.now(),
    };
    if (!latestCandidate) {
      latestCandidate = candidate;
    }
    const copy = raw.slice(0);
    postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: candidate.binaryUrl, modelKey: candidate.modelKey, detectionId: candidate.id }, [copy]);
  }

  function attachWorker(worker: Worker) {
    if (inspectedWorkers.has(worker)) return;
    inspectedWorkers.add(worker);
    worker.addEventListener('message', (ev) => {
      try {
        inspectWorkerMessage(worker, ev.data);
      } catch {
        // ignore
      }
    });
  }

  if (NativeWorker?.prototype) {
    const nativeWorkerAddEventListener = NativeWorker.prototype.addEventListener;
    NativeWorker.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (type === 'message') attachWorker(this);
      return nativeWorkerAddEventListener.apply(this, arguments as unknown as Parameters<Worker['addEventListener']>);
    };

    const nativeWorkerPostMessage = NativeWorker.prototype.postMessage;
    NativeWorker.prototype.postMessage = function (message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions) {
      recordWorkerRequest(this, message);
      if (transferOrOptions === undefined) return nativeWorkerPostMessage.call(this, message);
      return nativeWorkerPostMessage.call(this, message, transferOrOptions as StructuredSerializeOptions);
    };

    const onmessageDescriptor = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage');
    if (onmessageDescriptor?.set) {
      const nativeOnmessageSetter = onmessageDescriptor.set;
      Object.defineProperty(NativeWorker.prototype, 'onmessage', {
        ...onmessageDescriptor,
        set(handler: ((this: Worker, ev: MessageEvent) => unknown) | null) {
          attachWorker(this);
          return nativeOnmessageSetter.call(this, handler);
        },
      });
    }

    function WorkerWrapper(this: Worker, scriptURL: string | URL, options?: WorkerOptions): Worker {
      const worker = new NativeWorker(scriptURL, options);
      attachWorker(worker);
      return worker;
    }
    WorkerWrapper.prototype = NativeWorker.prototype;
    Object.setPrototypeOf(WorkerWrapper, NativeWorker);
    window.Worker = WorkerWrapper as unknown as typeof Worker;
  }

  // Inspect network requests (fetch & XHR & Image) for model assets
  function inspectUrl(input: unknown) {
    const urlStr = getUrlString(input);
    if (!urlStr) return;

    try {
      const url = new URL(urlStr, window.location.href);
      const pathname = url.pathname;

      if (/(^|\/)(?:model|mesh|animation|rigged|motion|rig)\.json$/i.test(pathname)) {
        const candidate = recordDetection(url.href, false);
        if (!candidate) return;
        postToContent('model-json-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
          modelKey: candidate.modelKey,
          detectionId: candidate.id,
        });
      } else if (meshyProvider.isBinaryAsset(url.href)) {
        const candidate = recordDetection(url.href, true);
        if (!candidate) return;
        postToContent('model-binary-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
          modelKey: candidate.modelKey,
          detectionId: candidate.id,
        });
      } else if (/^texture_[^/]*\.png/i.test(pathname.split('/').pop() ?? '')) {
        postToContent('texture-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
          modelKey: modelKeyFromAssetUrl(url.href),
        });
      }
    } catch {
      // ignore
    }
  }

  const nativeFetch = window.fetch;
  let lastCapturedBlob: { buffer: ArrayBuffer; capturedAt: number; modelKey?: string } | undefined;

  // Some viewers hand an already-loaded GLB to their loader via a Blob URL,
  // without returning it in a worker response. Capture the existing bytes.
  function captureLoadedBlob(blob: Blob, candidate: DetectionRecord | undefined) {
    if (blob.size < 12) return;
    const capturedCandidate = candidate ? { ...candidate } : (latestCandidate ? { ...latestCandidate } : undefined);
    void blob.slice(0, 12).arrayBuffer().then(async (header) => {
      if (!looksLikeGlb(header)) return;
      const buffer = await blob.arrayBuffer();
      lastCapturedBlob = { buffer: buffer.slice(0), capturedAt: Date.now(), modelKey: capturedCandidate?.modelKey };

      const activeCandidate: DetectionRecord = capturedCandidate ?? {
        id: `meshy-blob-${Date.now()}-${++detectionSequence}`,
        modelKey: window.location.href.split('?')[0].split('#')[0],
        detectedAt: Date.now(),
      };
      latestCandidate = activeCandidate;
      postToContent('model-binary-detected', {
        url: activeCandidate.binaryUrl ?? activeCandidate.modelKey,
        pageUrl: window.location.href,
        capturedAt: Date.now(),
        modelKey: activeCandidate.modelKey,
        detectionId: activeCandidate.id,
      });

      postToContent('glb-ready', {
        data: buffer, byteLength: buffer.byteLength, capturedAt: Date.now(),
        url: activeCandidate.binaryUrl, modelKey: activeCandidate.modelKey,
        detectionId: activeCandidate.id,
      }, [buffer]);
    }).catch(() => {});
  }

  const nativeCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object: Blob | MediaSource) {
    const url = nativeCreateObjectURL.call(this, object);
    if (object instanceof Blob) captureLoadedBlob(object, latestCandidate);
    return url;
  };

  if (typeof Response !== 'undefined' && Response.prototype?.arrayBuffer) {
    const nativeResponseArrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function () {
      return nativeResponseArrayBuffer.apply(this).then((buffer: ArrayBuffer) => {
        if (looksLikeGlb(buffer)) {
          const url = this.url || latestCandidate?.binaryUrl;
          const candidate = (url ? recordDetection(url, true) : undefined) ?? latestCandidate ?? {
            id: `meshy-resp-${Date.now()}-${++detectionSequence}`,
            modelKey: window.location.href.split('?')[0].split('#')[0],
            detectedAt: Date.now(),
          };
          latestCandidate = candidate;
          const copy = buffer.slice(0);
          postToContent('glb-ready', {
            data: copy,
            byteLength: copy.byteLength,
            capturedAt: Date.now(),
            url: candidate.binaryUrl ?? this.url,
            modelKey: candidate.modelKey,
            detectionId: candidate.id,
          }, [copy]);
        }
        return buffer;
      });
    };
  }

  if (typeof Response !== 'undefined' && Response.prototype?.blob) {
    const nativeResponseBlob = Response.prototype.blob;
    Response.prototype.blob = function () {
      return nativeResponseBlob.apply(this).then((blob: Blob) => {
        if (blob && blob.size >= 12) {
          const url = this.url || latestCandidate?.binaryUrl;
          const candidate = (url ? recordDetection(url, true) : undefined) ?? latestCandidate;
          captureLoadedBlob(blob, candidate);
        }
        return blob;
      });
    };
  }

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    try {
      inspectUrl(input);
    } catch {
      // ignore
    }
    const resolvedUrl = resolveUrl(input);
    const promise = nativeFetch.apply(this, [input, init]);

    promise
      .then((res) => {
        if (!(res.headers.get('content-type')?.toLowerCase() ?? '').includes('json')) return undefined;
        return res.clone().json().then((json) => ({ json, responseUrl: res.url || resolvedUrl || window.location.href }));
      })
      .then((result) => {
        if (!result) return;
        const assetUrls = findMeshyAssetUrlsInObject(result.json, result.responseUrl);
        const modelUrls = assetUrls.filter((url) => meshyProvider.isModelAsset(url));
        const routeHint = meshyProvider.extractModelId(window.location.href)?.toLowerCase();
        const filtered = routeHint ? modelUrls.filter((url) => url.toLowerCase().includes(routeHint)) : [];
        const selected = filtered.length > 0 ? filtered : modelUrls;
        for (const assetUrl of selected) inspectUrl(assetUrl);
        for (const textureUrl of assetUrls.filter((url) => meshyProvider.isTexture(url))) inspectUrl(textureUrl);
      })
      .catch(() => {});

    // If fetching model.meshy directly as binary
    if (resolvedUrl && meshyProvider.isBinaryAsset(resolvedUrl)) {
      const requestCandidate = recordDetection(resolvedUrl, true);
      promise
        .then((res) => res.clone().arrayBuffer())
        .then((buffer) => {
          if (looksLikeGlb(buffer)) {
            if (!requestCandidate) return;
            const copy = buffer.slice(0);
            postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: resolvedUrl, modelKey: requestCandidate.modelKey, detectionId: requestCandidate.id }, [copy]);
          }
        })
        .catch(() => {});
    }

    return promise;
  };

  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype?.open) {
    const nativeXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
      try {
        inspectUrl(url);
      } catch {
        // ignore
      }

      const resolvedUrl = resolveUrl(url);
      this.addEventListener('load', () => {
        try {
          const contentType = this.getResponseHeader('content-type')?.toLowerCase() ?? '';
          let json: unknown;
          if (this.responseType === 'json' && this.response) json = this.response;
          else if ((this.responseType === '' || this.responseType === 'text') && contentType.includes('json')) json = JSON.parse(this.responseText);
          if (json) {
            const assetUrls = findMeshyAssetUrlsInObject(json, this.responseURL || resolvedUrl || window.location.href);
            const modelUrls = assetUrls.filter((assetUrl) => meshyProvider.isModelAsset(assetUrl));
            const routeHint = meshyProvider.extractModelId(window.location.href)?.toLowerCase();
            const filtered = routeHint ? modelUrls.filter((assetUrl) => assetUrl.toLowerCase().includes(routeHint)) : [];
            const selected = filtered.length > 0 ? filtered : modelUrls;
            for (const assetUrl of selected) inspectUrl(assetUrl);
            for (const textureUrl of assetUrls.filter((assetUrl) => meshyProvider.isTexture(assetUrl))) inspectUrl(textureUrl);
          }
        } catch {
          // ignore non-JSON, inaccessible, and malformed responses
        }
      });

      const requestCandidate = resolvedUrl && meshyProvider.isBinaryAsset(resolvedUrl)
        ? recordDetection(resolvedUrl, true)
        : undefined;

      this.addEventListener('load', () => {
        try {
          const resp = this.response;
          if (resp instanceof Blob && resp.size >= 12) {
            captureLoadedBlob(resp, requestCandidate ?? latestCandidate);
          } else if (resp instanceof ArrayBuffer && looksLikeGlb(resp)) {
            const cand = requestCandidate ?? (resolvedUrl ? recordDetection(resolvedUrl, true) : undefined) ?? latestCandidate ?? {
              id: `meshy-xhr-${Date.now()}-${++detectionSequence}`,
              modelKey: window.location.href.split('?')[0].split('#')[0],
              detectedAt: Date.now(),
            };
            latestCandidate = cand;
            const copy = resp.slice(0);
            postToContent('glb-ready', {
              data: copy,
              byteLength: copy.byteLength,
              capturedAt: Date.now(),
              url: resolvedUrl ?? cand.binaryUrl,
              modelKey: cand.modelKey,
              detectionId: cand.id,
            }, [copy]);
          }
        } catch {
          // ignore
        }
      });

      return (nativeXhrOpen as Function).apply(this, [method, url, ...rest]);
    };
  }

  // Intercept programmatic anchor tag downloads (e.g. Meshy's Export action creating <a download> for GLB)
  if (typeof HTMLAnchorElement !== 'undefined' && HTMLAnchorElement.prototype?.click) {
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        // Skip PolyFetch's own programmatic downloads to avoid capture loops
        if (this.hasAttribute('data-polyfetch') || this.dataset?.polyfetch === 'true') {
          return nativeAnchorClick.apply(this);
        }
        const href = this.href;
        const download = this.download;
        if (href && (download || /\.glb(?:[?#]|$)/i.test(href))) {
          if (href.startsWith('blob:')) {
            void (window.fetch || fetch)(href)
              .then((r) => r.blob())
              .then((b) => captureLoadedBlob(b, latestCandidate))
              .catch(() => {});
          } else if (meshyProvider.isBinaryAsset(href) || /\.glb(?:[?#]|$)/i.test(href)) {
            inspectUrl(href);
          }
        }
      } catch {
        // ignore
      }
      return nativeAnchorClick.apply(this);
    };
  }

  if (typeof HTMLImageElement !== 'undefined') {
    const imageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (imageSrcDescriptor?.set) {
      const nativeImageSrcSetter = imageSrcDescriptor.set;
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        ...imageSrcDescriptor,
        set(value: string) {
          try {
            inspectUrl(value);
          } catch {
            // ignore
          }
          return nativeImageSrcSetter.call(this, value);
        },
      });
    }
  }

  // Answer status requests
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (typeof data === 'object' && data !== null && data.source === CONTENT_SOURCE && data.type === 'request-model-buffer') {
      const candidate = latestCandidate ? { ...latestCandidate } : undefined;
      if (!candidate) return;
      const reqKey = data.modelKey ? String(data.modelKey) : undefined;
      if (reqKey && candidate.modelKey !== reqKey && !candidate.modelKey.includes(reqKey) && !reqKey.includes(candidate.modelKey)) {
        return;
      }
      const sendBuffer = (buffer: ArrayBuffer, targetCandidate?: DetectionRecord) => {
        if (!looksLikeGlb(buffer)) {
          const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)));
          if (header.startsWith('MESHY.AI')) return; // Wait for the viewer's decoder.
          throw new Error('The model URL returned data that is not a GLB. Reopen the model and retry.');
        }
        const activeRec = targetCandidate ?? candidate;
        const copy = buffer.slice(0);
        postToContent('glb-ready', {
          data: copy,
          byteLength: copy.byteLength,
          capturedAt: Date.now(),
          url: activeRec.binaryUrl,
          modelKey: activeRec.modelKey,
          detectionId: activeRec.id,
        }, [copy]);
      };

      const matchesDecoded = lastDecoded && (
        lastDecoded.candidate.modelKey === candidate.modelKey ||
        lastDecoded.candidate.modelKey.includes(candidate.modelKey) ||
        candidate.modelKey.includes(lastDecoded.candidate.modelKey)
      );

      let sentBuffer = false;
      if (lastDecodedMesh && (
        lastDecodedMesh.candidate.modelKey === candidate.modelKey ||
        lastDecodedMesh.candidate.modelKey.includes(candidate.modelKey) ||
        candidate.modelKey.includes(lastDecodedMesh.candidate.modelKey)
      )) {
        sendBuffer(lastDecodedMesh.buffer, lastDecodedMesh.candidate);
        sentBuffer = true;
      }
      if (lastDecodedAnim && lastDecodedAnim !== lastDecodedMesh && (
        lastDecodedAnim.candidate.modelKey === candidate.modelKey ||
        lastDecodedAnim.candidate.modelKey.includes(candidate.modelKey) ||
        candidate.modelKey.includes(lastDecodedAnim.candidate.modelKey)
      )) {
        sendBuffer(lastDecodedAnim.buffer, lastDecodedAnim.candidate);
        sentBuffer = true;
      }
      if (!sentBuffer && matchesDecoded && lastDecoded) {
        sendBuffer(lastDecoded.buffer, lastDecoded.candidate);
        sentBuffer = true;
      } else if (!sentBuffer && lastCapturedBlob && (!candidate.binaryUrl || lastCapturedBlob.modelKey === candidate.modelKey || lastCapturedBlob.modelKey === undefined)) {
        sendBuffer(lastCapturedBlob.buffer, candidate);
        sentBuffer = true;
      } else if (!sentBuffer && candidate.binaryUrl) {
        // Use the page's network context and only a URL already observed there.
        // Encrypted .meshy payloads must still be decoded by the site's viewer.
        void nativeFetch(candidate.binaryUrl, { signal: AbortSignal.timeout(25000) })
          .then((response) => {
            if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}).`);
            return response.arrayBuffer();
          })
          .then((buf) => sendBuffer(buf, candidate))
          .catch((error) => postToContent('model-buffer-error', {
            modelKey: candidate.modelKey,
            error: error instanceof Error ? error.message : 'Unable to retrieve the model.',
          }));
      }
      return;
    }
    if (typeof data === 'object' && data !== null && data.source === CONTENT_SOURCE && data.type === 'status-request') {
      postToContent('installed', { at: Date.now(), url: window.location.href });
      if (latestCandidate?.binaryUrl) {
        postToContent('model-binary-detected', {
          url: latestCandidate.binaryUrl,
          pageUrl: window.location.href,
          capturedAt: latestCandidate.detectedAt,
          modelKey: latestCandidate.modelKey,
          detectionId: latestCandidate.id,
        });
      } else if (latestCandidate) {
        postToContent('model-json-detected', {
          url: latestCandidate.modelKey,
          pageUrl: window.location.href,
          capturedAt: latestCandidate.detectedAt,
          modelKey: latestCandidate.modelKey,
          detectionId: latestCandidate.id,
        });
      }
      const matchesDecoded = lastDecoded && (
        !latestCandidate ||
        lastDecoded.candidate.modelKey === latestCandidate.modelKey ||
        lastDecoded.candidate.modelKey.includes(latestCandidate.modelKey) ||
        latestCandidate.modelKey.includes(lastDecoded.candidate.modelKey)
      );
      let sentStatusGlb = false;
      if (lastDecodedMesh && (
        !latestCandidate ||
        lastDecodedMesh.candidate.modelKey === latestCandidate.modelKey ||
        lastDecodedMesh.candidate.modelKey.includes(latestCandidate.modelKey) ||
        latestCandidate.modelKey.includes(lastDecodedMesh.candidate.modelKey)
      )) {
        const copy = lastDecodedMesh.buffer.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), modelKey: lastDecodedMesh.candidate.modelKey, url: lastDecodedMesh.candidate.binaryUrl, detectionId: lastDecodedMesh.candidate.id }, [copy]);
        sentStatusGlb = true;
      }
      if (lastDecodedAnim && lastDecodedAnim !== lastDecodedMesh && (
        !latestCandidate ||
        lastDecodedAnim.candidate.modelKey === latestCandidate.modelKey ||
        lastDecodedAnim.candidate.modelKey.includes(latestCandidate.modelKey) ||
        latestCandidate.modelKey.includes(lastDecodedAnim.candidate.modelKey)
      )) {
        const copy = lastDecodedAnim.buffer.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), modelKey: lastDecodedAnim.candidate.modelKey, url: lastDecodedAnim.candidate.binaryUrl, detectionId: lastDecodedAnim.candidate.id }, [copy]);
        sentStatusGlb = true;
      }
      if (!sentStatusGlb && matchesDecoded && lastDecoded) {
        const copy = lastDecoded.buffer.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), modelKey: lastDecoded.candidate.modelKey, url: lastDecoded.candidate.binaryUrl, detectionId: lastDecoded.candidate.id }, [copy]);
      } else if (!sentStatusGlb && lastCapturedBlob && (!latestCandidate || !latestCandidate.binaryUrl || lastCapturedBlob.modelKey === latestCandidate.modelKey || lastCapturedBlob.modelKey === undefined)) {
        const copy = lastCapturedBlob.buffer.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), modelKey: lastCapturedBlob.modelKey ?? latestCandidate?.modelKey ?? window.location.href.split('?')[0].split('#')[0], url: latestCandidate?.binaryUrl, detectionId: latestCandidate?.id }, [copy]);
      }
    }
  });

  postToContent('installed', { at: Date.now(), url: window.location.href });
}
