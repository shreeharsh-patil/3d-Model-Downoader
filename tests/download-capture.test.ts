import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeModelBuffer, encodeModelBuffer } from '../src/lib/binary-message';
import { findDecodedGlb, installMeshyMainWorldHook } from '../src/lib/meshy-main-world-hook';
import { CONTENT_SOURCE } from '../src/lib/messages';

function glb() {
  const bytes = new Uint8Array(24);
  bytes.set([103, 108, 84, 70, 2]);
  return bytes.buffer;
}

afterEach(() => vi.unstubAllGlobals());

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
  });
});
