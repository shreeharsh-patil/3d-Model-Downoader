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

function findGlbUrlsInObject(obj: unknown, found: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return found;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      findGlbUrlsInObject(item, found);
    }
    return found;
  }

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (
        lower.includes('.glb') ||
        lower.includes('meshopt') ||
        lower.includes('.gltf') ||
        lower.includes('file.osgjs') ||
        lower.includes('model_file.bin')
      ) {
        if (val.startsWith('http://') || val.startsWith('https://')) {
          found.push(val);
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      findGlbUrlsInObject(val, found);
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

    // Inspect API responses that might contain the model URL or thumbnail
    if (urlStr && (urlStr.includes('/api/') || urlStr.includes('/task/') || urlStr.includes('/model/') || urlStr.includes('/draft/'))) {
      promise
        .then((res) => res.clone().json())
        .then((json) => {
          const glbUrls = findGlbUrlsInObject(json);
          const thumbUrls = findThumbnailsInObject(json);
          const previewUrl = thumbUrls[0];
          for (const glbUrl of glbUrls) {
            handleDetectedUrl(glbUrl, previewUrl, 'api-response');
          }
          if (previewUrl && glbUrls.length === 0) {
            postToContent('tripo-preview-detected', {
              previewUrl,
              capturedAt: Date.now(),
            });
          }
        })
        .catch(() => {});
    }

    return promise;
  };

  // Intercept XMLHttpRequest
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
    const urlStr = getUrlString(url);
    if (urlStr) {
      handleDetectedUrl(urlStr);
    }

    if (urlStr && (urlStr.includes('/api/') || urlStr.includes('/task/') || urlStr.includes('/model/') || urlStr.includes('/draft/'))) {
      this.addEventListener('load', () => {
        try {
          let json: unknown;
          if (this.responseType === '' || this.responseType === 'text') {
            json = JSON.parse(this.responseText);
          } else if (this.responseType === 'json' && this.response) {
            json = this.response;
          }
          if (json) {
            const glbUrls = findGlbUrlsInObject(json);
            const thumbUrls = findThumbnailsInObject(json);
            const previewUrl = thumbUrls[0];
            for (const glbUrl of glbUrls) {
              handleDetectedUrl(glbUrl, previewUrl, 'api-response');
            }
            if (previewUrl && glbUrls.length === 0) {
              postToContent('tripo-preview-detected', {
                previewUrl,
                capturedAt: Date.now(),
              });
            }
          }
        } catch {
          // ignore
        }
      });
    }

    return (nativeXhrOpen as Function).apply(this, [method, url, ...rest]);
  };

  postToContent('installed', { at: Date.now(), url: window.location.href });
}
