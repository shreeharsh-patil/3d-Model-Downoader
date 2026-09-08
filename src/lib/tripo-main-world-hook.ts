import { BRIDGE_SOURCE, CONTENT_SOURCE } from './messages';
import { findProvider } from './providers/registry';
import { tripoProvider } from './providers/tripo/tripo-provider';

const INSTALLED_KEY = '__3d_model_downloader_tripo_hook_installed__';

function getUrlString(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return undefined;
}

const MODEL_URL_MARKER = /(?:\.glb(?:[?#]|$)|meshopt|\.gltf(?:[?#]|$)|file\.osgjs(?:[?#]|$)|model_file\.bin(?:[?#]|$))/i;

function resolveAssetUrl(value: string, baseUrl: string): string | undefined {
  try {
    const resolved = new URL(value, baseUrl);
    return /^https?:$/.test(resolved.protocol) ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

export function findGlbUrlsInObject(obj: unknown, baseUrl: string, found: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return found;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findGlbUrlsInObject(item, baseUrl, found);
    }
    return found;
  }

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'string') {
      if (MODEL_URL_MARKER.test(val)) {
        const resolved = resolveAssetUrl(val, baseUrl);
        if (resolved && !found.includes(resolved)) found.push(resolved);
      }
    } else if (typeof val === 'object' && val !== null) {
      findGlbUrlsInObject(val, baseUrl, found);
    }
  }

  return found;
}

function findThumbnailsInObject(obj: unknown, found: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return found;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findThumbnailsInObject(item, found);
    }
    return found;
  }

  const thumbKeyRegex = /(thumb|preview|cover|rendered_image|image_url|snapshot)/i;
  const imageExtRegex = /\.(webp|png|jpe?g)(\?|$)/i;

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
      if (thumbKeyRegex.test(key) || imageExtRegex.test(val)) {
        if (!/avatar|logo|favicon|badge|icon/i.test(val)) {
          found.push(val);
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      findThumbnailsInObject(val, found);
    }
  }

  return found;
}

export function installTripoMainWorldHook() {
  const w = window as typeof window & Record<string, unknown>;
  if (w[INSTALLED_KEY]) return;
  w[INSTALLED_KEY] = true;

  function postToContent(type: string, payload: Record<string, unknown>) {
    try {
      window.postMessage(
        { source: BRIDGE_SOURCE, type, payload },
        window.location.origin,
      );
    } catch {
      // ignore
    }
  }

  function handleDetectedUrl(url: string, previewUrl?: string, source: 'api-response' | 'network' = 'network') {
    const provider = findProvider(window.location.href) ?? tripoProvider;
    if (provider.isModelAsset(url)) {
      postToContent('tripo-glb-url-detected', {
        url,
        previewUrl,
        provider: provider.id,
        capturedAt: Date.now(),
        pageUrl: window.location.href,
        source,
      });
    }
  }

  function inspectApiPayload(payload: unknown, responseUrl = window.location.href) {
    const glbUrls = findGlbUrlsInObject(payload, responseUrl);
    const thumbUrls = findThumbnailsInObject(payload);
    const previewUrl = thumbUrls[0];
    const routeHint = (findProvider(window.location.href) ?? tripoProvider).extractModelId(window.location.href)?.toLowerCase();
    const selectedUrls = glbUrls.length === 1
      ? glbUrls
      : routeHint
        ? glbUrls.filter((url) => url.toLowerCase().includes(routeHint))
        : [];
    for (const glbUrl of selectedUrls) handleDetectedUrl(glbUrl, previewUrl, 'api-response');
    if (previewUrl && selectedUrls.length === 0) {
      postToContent('tripo-preview-detected', { previewUrl, capturedAt: Date.now() });
    }
  }

  // SPA route navigation tracking
  const nativePushState = history.pushState;
  history.pushState = function (...args) {
    const res = nativePushState.apply(this, args);
    postToContent('route-changed', { url: window.location.href, at: Date.now() });
    return res;
  };

  const nativeReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const res = nativeReplaceState.apply(this, args);
    postToContent('route-changed', { url: window.location.href, at: Date.now() });
    return res;
  };

  window.addEventListener('popstate', () => {
    postToContent('route-changed', { url: window.location.href, at: Date.now() });
  });

  // Intercept fetch
  const nativeFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const urlStr = getUrlString(input);
    if (urlStr) {
      handleDetectedUrl(urlStr);
    }

    const promise = nativeFetch.apply(this, [input, init]);

    // Studio API routes change over time. Inspect JSON by response content type
    // instead of relying on a short allowlist of URL path fragments.
    promise
      .then((res) => {
        const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
        if (!contentType.includes('json')) return undefined;
        return res.clone().json().then((json) => ({ json, responseUrl: res.url || urlStr || window.location.href }));
      })
      .then((result) => {
        if (result) inspectApiPayload(result.json, result.responseUrl);
      })
      .catch(() => {});

    return promise;
  };

  // Intercept XMLHttpRequest
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
    const urlStr = getUrlString(url);
    if (urlStr) {
      handleDetectedUrl(urlStr);
    }

    this.addEventListener('load', () => {
      try {
        const contentType = this.getResponseHeader('content-type')?.toLowerCase() ?? '';
        let json: unknown;
        if (this.responseType === 'json' && this.response) {
          json = this.response;
        } else if ((this.responseType === '' || this.responseType === 'text') && contentType.includes('json')) {
          json = JSON.parse(this.responseText);
        }
        if (json) inspectApiPayload(json, this.responseURL || urlStr || window.location.href);
      } catch {
        // ignore non-JSON, inaccessible, and malformed responses
      }
    });

    return (nativeXhrOpen as Function).apply(this, [method, url, ...rest]);
  };

  postToContent('installed', { at: Date.now(), url: window.location.href });
}
