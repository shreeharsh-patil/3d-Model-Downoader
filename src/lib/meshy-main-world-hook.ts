import { BRIDGE_SOURCE, CONTENT_SOURCE } from './messages';
import { meshyProvider } from './providers/meshy/meshy-provider';

const INSTALLED_KEY = '__3d_model_downloader_installed__';

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

  function inspectWorkerMessage(data: unknown) {
    if (typeof data !== 'object' || data === null) return;
    const record = data as Record<string, unknown>;

    if (record.type === 'process' && record.success === true) {
      const raw = toArrayBuffer(record.data);
      if (raw && looksLikeGlb(raw)) {
        const copy = raw.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: window.location.href }, [copy]);
        return;
      }
    }

    // Inspect direct properties for decoded GLB
    for (const key of Object.keys(record)) {
      const raw = toArrayBuffer(record[key]);
      if (raw && looksLikeGlb(raw)) {
        const copy = raw.slice(0);
        postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: window.location.href }, [copy]);
        return;
      }
    }
  }

  function attachWorker(worker: Worker) {
    if (inspectedWorkers.has(worker)) return;
    inspectedWorkers.add(worker);
    worker.addEventListener('message', (ev) => {
      try {
        inspectWorkerMessage(ev.data);
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
        postToContent('model-json-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
        });
      } else if (/(^|\/)model\.meshy$/i.test(pathname)) {
        postToContent('model-binary-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
        });
      } else if (/^texture_[^/]*\.png/i.test(pathname.split('/').pop() ?? '')) {
        postToContent('texture-detected', {
          url: url.href,
          pageUrl: window.location.href,
          capturedAt: Date.now(),
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
      promise
        .then((res) => res.clone().arrayBuffer())
        .then((buffer) => {
          if (looksLikeGlb(buffer)) {
            const copy = buffer.slice(0);
            postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: urlStr }, [copy]);
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
      this.addEventListener('load', () => {
        const resp = this.response;
        if (resp instanceof ArrayBuffer && looksLikeGlb(resp)) {
          const copy = resp.slice(0);
          postToContent('glb-ready', { data: copy, byteLength: copy.byteLength, capturedAt: Date.now(), url: urlStr }, [copy]);
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
