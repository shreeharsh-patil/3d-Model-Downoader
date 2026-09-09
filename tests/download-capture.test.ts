import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeModelBuffer, encodeBufferSlice, encodeModelBuffer } from '../src/lib/binary-message';
import { findDecodedGlb, installMeshyMainWorldHook } from '../src/lib/meshy-main-world-hook';
import { CONTENT_SOURCE } from '../src/lib/messages';

function glb() {
  const bytes = new Uint8Array(24);
  bytes.set([103, 108, 84, 70, 2]);
  return bytes.buffer;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('model capture and transport', () => {
  it('preserves binary bytes through Chrome JSON message serialization', () => {
    const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256);
    const response = JSON.parse(JSON.stringify({ bufferBase64: encodeModelBuffer(bytes.buffer) }));
    expect(new Uint8Array(decodeModelBuffer(response.bufferBase64))).toEqual(bytes);
  });

  it('recognizes direct, nested, and offset typed-array worker results', () => {
    const buffer = glb();
    expect(findDecodedGlb(buffer)).toEqual(buffer);
    expect(findDecodedGlb({ result: { data: buffer } })).toEqual(buffer);
    const padded = new Uint8Array(40);
    padded.set(new Uint8Array(buffer), 8);
    expect(findDecodedGlb({ data: padded.subarray(8, 32) })).toEqual(buffer);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(findDecodedGlb(cyclic)).toBeNull();
  });

  it('retrieves a detected GLB, replays it after a missed event, and exposes HTTP errors', async () => {
    class WorkerMock extends EventTarget {
      postMessage() {}
      override addEventListener(...args: Parameters<EventTarget['addEventListener']>) { super.addEventListener(...args); }
    }
    class XhrMock extends EventTarget { open() {} }
    class ImageMock {}
    const messages: any[] = [];
    const listeners = new Map<string, Function[]>();
    let failFetch = false;
    const nativeFetch = vi.fn(async () => new Response(failFetch ? 'Forbidden' : glb(), { status: failFetch ? 403 : 200 }));
    const win = {
      location: { href: 'https://www.meshy.ai/workspace', origin: 'https://www.meshy.ai' },
      Worker: WorkerMock,
      fetch: nativeFetch,
      postMessage: (message: unknown) => messages.push(structuredClone(message)),
      addEventListener: (type: string, listener: Function) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('history', { pushState() {}, replaceState() {} });
    vi.stubGlobal('XMLHttpRequest', XhrMock);
    vi.stubGlobal('HTMLImageElement', ImageMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:captured-model');
    installMeshyMainWorldHook();
    const send = (type: string, modelKey?: string) => {
      for (const listener of listeners.get('message') ?? []) listener({ source: win, data: { source: CONTENT_SOURCE, type, modelKey } });
    };
    // XHR open detects the URL without delivering any bytes to the hook.
    (new XhrMock().open as Function)('GET', 'https://cdn.meshy.ai/task/one/model.glb');
    send('request-model-buffer', 'https://cdn.meshy.ai/task/one');
    await vi.waitFor(() => expect(messages.some(m => m.type === 'glb-ready')).toBe(true));
    messages.length = 0;
    send('status-request');
    expect(messages.some(m => m.type === 'model-binary-detected')).toBe(true);
    expect(messages.find(m => m.type === 'glb-ready').payload.data).toEqual(glb());
    failFetch = true;
    (new XhrMock().open as Function)('GET', 'https://cdn.meshy.ai/task/two/model.glb');
    send('request-model-buffer', 'https://cdn.meshy.ai/task/two');
    await vi.waitFor(() => expect(messages.find(m => m.type === 'model-buffer-error')?.payload.error).toContain('403'));
    const calls = nativeFetch.mock.calls.length;
    send('request-model-buffer', 'https://unobserved.example/model');
    expect(nativeFetch).toHaveBeenCalledTimes(calls);
    // An initialization request for the previous model must not steal the
    // next model's raw (unlabelled) worker decode response.
    const worker = new win.Worker();
    (worker.postMessage as Function)({ type: 'init' });
    (new XhrMock().open as Function)('GET', 'https://cdn.meshy.ai/task/three/model.glb');
    (worker.postMessage as Function)({ type: 'process' });
    worker.dispatchEvent(new MessageEvent('message', { data: glb() }));
    expect(messages.filter(m => m.type === 'glb-ready').at(-1)?.payload.modelKey).toBe('https://cdn.meshy.ai/task/three');
    messages.length = 0;
    URL.createObjectURL(new Blob([glb()], { type: 'application/octet-stream' }));
    // Switching selection while the Blob is read must not relabel its bytes.
    (new XhrMock().open as Function)('GET', 'https://cdn.meshy.ai/task/four/model.glb');
    await vi.waitFor(() => expect(messages.find(m => m.type === 'glb-ready')?.payload.modelKey).toBe('https://cdn.meshy.ai/task/three'));
    expect(messages.find(m => m.type === 'glb-ready')?.payload.data).toEqual(glb());
  });

  it('ignores polyfetch download anchors to prevent capture loops', async () => {
    class AnchorMock {
      href = '';
      download = '';
      dataset: Record<string, string> = {};
      attributes = new Map<string, string>();
      setAttribute(name: string, val: string) { this.attributes.set(name, val); }
      hasAttribute(name: string) { return this.attributes.has(name); }
      click() {}
    }
    const nativeClick = vi.fn();
    AnchorMock.prototype.click = nativeClick;
    const fetchSpy = vi.fn(async () => new Response(glb()));
    const win = {
      location: { href: 'https://www.meshy.ai/workspace', origin: 'https://www.meshy.ai' },
      fetch: fetchSpy,
      postMessage: () => {},
      addEventListener: () => {},
    };
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('window', win);
    vi.stubGlobal('HTMLAnchorElement', AnchorMock);
    installMeshyMainWorldHook();

    // Standard anchor with blob URL is fetched to capture model
    const externalAnchor = new AnchorMock();
    externalAnchor.href = 'blob:https://www.meshy.ai/meshy-model';
    externalAnchor.download = 'model.glb';
    externalAnchor.click();
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('blob:https://www.meshy.ai/meshy-model', undefined);

    fetchSpy.mockClear();

    // PolyFetch download anchor is bypassed without triggering a fetch / re-detection
    const polyfetchAnchor = new AnchorMock();
    polyfetchAnchor.href = 'blob:https://www.meshy.ai/polyfetch-export';
    polyfetchAnchor.download = 'exported.glb';
    polyfetchAnchor.setAttribute('data-polyfetch', 'true');
    polyfetchAnchor.click();
    expect(nativeClick).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('correctly chunks and reassembles large binary buffers', () => {
    // Verify multi-chunk slicing and exact byte-for-byte reassembly
    const totalBytes = 50000;
    const chunkSize = 16384;
    const original = Uint8Array.from({ length: totalBytes }, (_, i) => (i * 7) % 256);

    const totalChunks = Math.ceil(totalBytes / chunkSize);
    const reassembled = new Uint8Array(totalBytes);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const chunkBase64 = encodeBufferSlice(original.buffer, start, end);
      const decodedChunk = decodeModelBuffer(chunkBase64);
      reassembled.set(new Uint8Array(decodedChunk), start);
    }

    expect(reassembled).toEqual(original);
  });
});

