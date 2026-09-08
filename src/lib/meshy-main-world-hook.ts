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

function getUrlString(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return undefined;
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
  const workerRequests = new WeakMap<Worker, WorkerRequestRecord[]>();

  function recordWorkerRequest(worker: Worker, message: unknown) {
    if (!latestCandidate) return;
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
    try {
      window.postMessage(
        { source: BRIDGE_SOURCE, type, payload },
        window.location.origin,
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
  const nativePushState = history.pushState;
  history.pushState = function (...args) {
    const res = nativePushState.apply(this, args);
    notifyRouteChanged();
    return res;
  };

  const nativeReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const res = nativeReplaceState.apply(this, args);
    notifyRouteChanged();
    return res;
  };

  window.addEventListener('popstate', notifyRouteChanged);

  // Hook Web Workers to capture decoded GLBs (model.meshy deobfuscation result)
  const NativeWorker = window.Worker;
  const inspectedWorkers = new WeakSet<Worker>();

  function inspectWorkerMessage(worker: Worker, data: unknown) {
    if (typeof data !== 'object' || data === null) return;
    const record = data as Record<string, unknown>;

    if (record.type === 'process' && record.success === true) {
      const raw = toArrayBuffer(record.data);
      if (raw && looksLikeGlb(raw)) {
        const candidate = takeWorkerCandidate(worker, data);
        if (!candidate) return;
        const copy = raw.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: candidate.binaryUrl, modelKey: candidate.modelKey, detectionId: candidate.id }, [copy]);
        return;
      }
    }

    // Inspect direct properties for decoded GLB
    for (const key of Object.keys(record)) {
      const raw = toArrayBuffer(record[key]);
      if (raw && looksLikeGlb(raw)) {
        const candidate = takeWorkerCandidate(worker, data);
        if (!candidate) return;
        const copy = raw.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: candidate.binaryUrl, modelKey: candidate.modelKey, detectionId: candidate.id }, [copy]);
        return;
      }
    }
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

  // Inspect network requests (fetch & XHR & Image) for model assets
  function inspectUrl(input: unknown) {
    const urlStr = getUrlString(input);
    if (!urlStr) return;

    try {
      const url = new URL(urlStr, window.location.href);
      const pathname = url.pathname;

      if (/(^|\/)(model|mesh)\.json$/i.test(pathname)) {
        const candidate = recordDetection(url.href, false);
        if (!candidate) return;
        postToContent('model-json-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
          modelKey: candidate.modelKey,
          detectionId: candidate.id,
        });
      } else if (/(^|\/)model\.meshy$/i.test(pathname)) {
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
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    try {
      inspectUrl(input);
    } catch {
      // ignore
    }
    const promise = nativeFetch.apply(this, [input, init]);

    // If fetching model.meshy directly as binary
    const urlStr = getUrlString(input);
    if (urlStr && meshyProvider.isBinaryAsset(urlStr)) {
      const requestCandidate = recordDetection(new URL(urlStr, window.location.href).href, true);
      promise
        .then((res) => res.clone().arrayBuffer())
        .then((buffer) => {
          if (looksLikeGlb(buffer)) {
            if (!requestCandidate) return;
            const copy = buffer.slice(0);
            postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: urlStr, modelKey: requestCandidate.modelKey, detectionId: requestCandidate.id }, [copy]);
          }
        })
        .catch(() => {});
    }

    return promise;
  };

  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
    try {
      inspectUrl(url);
    } catch {
      // ignore
    }

    const urlStr = getUrlString(url);
    if (urlStr && meshyProvider.isBinaryAsset(urlStr)) {
      const requestCandidate = recordDetection(new URL(urlStr, window.location.href).href, true);
      this.addEventListener('load', () => {
        const resp = this.response;
        if (resp instanceof ArrayBuffer && looksLikeGlb(resp)) {
          if (!requestCandidate) return;
          const copy = resp.slice(0);
          postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: urlStr, modelKey: requestCandidate.modelKey, detectionId: requestCandidate.id }, [copy]);
        }
      });
    }

    return (nativeXhrOpen as Function).apply(this, [method, url, ...rest]);
  };

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

  // Answer status requests
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (typeof data === 'object' && data !== null && data.source === CONTENT_SOURCE && data.type === 'status-request') {
      postToContent('installed', { at: Date.now(), url: window.location.href });
    }
  });

  postToContent('installed', { at: Date.now(), url: window.location.href });
}
