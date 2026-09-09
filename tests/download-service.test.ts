import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDownload } from '../src/lib/download-service';
import { GLB_JSON_CHUNK_TYPE, GLB_MAGIC, GLB_VERSION } from '../src/lib/glb-validator';

function createValidGlbBuffer(gltfJson: Record<string, unknown> = {}): ArrayBuffer {
  const jsonStr = JSON.stringify(gltfJson);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Header
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);

  // JSON chunk header
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);

  // Pad with spaces
  uint8.fill(0x20, 20, 20 + paddedJsonLength);
  uint8.set(jsonBytes, 20);

  return buffer;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Download Service', () => {
  it('creates a DOM anchor with data-polyfetch and clicks it without base64 transcoding', async () => {
    const validGlb = createValidGlbBuffer({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ componentType: 5126, count: 3, type: 'VEC3' }],
    });
    const clickedElements: any[] = [];

    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      dataset: {} as Record<string, string>,
      attributes: new Map<string, string>(),
      setAttribute(name: string, val: string) {
        this.attributes.set(name, val);
      },
      hasAttribute(name: string) {
        return this.attributes.has(name);
      },
      click() {
        clickedElements.push(this);
      },
      remove: vi.fn(),
    };

    const mockDoc = {
      createElement: vi.fn((tag: string) => {
        if (tag === 'a') return mockAnchor;
        return {};
      }),
      body: {
        appendChild: vi.fn(),
      },
      documentElement: {
        appendChild: vi.fn(),
      },
    };

    vi.stubGlobal('document', mockDoc);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-download-blob'),
      revokeObjectURL: vi.fn(),
    });

    const result = await executeDownload(validGlb, {
      modelName: 'SciFi_Mech',
      provider: 'meshy',
      exportFormat: 'glb',
    });

    expect(result.success).toBe(true);
    expect(result.filename).toBe('SciFi_Mech_meshy.glb');
    expect(result.size).toBe(validGlb.byteLength);
    expect(mockDoc.createElement).toHaveBeenCalledWith('a');
    expect(mockAnchor.download).toBe('SciFi_Mech_meshy.glb');
    expect(mockAnchor.hasAttribute('data-polyfetch')).toBe(true);
    expect(mockAnchor.dataset.polyfetch).toBe('true');
    expect(clickedElements).toHaveLength(1);
    expect(clickedElements[0]).toBe(mockAnchor);
  });

  it('rejects invalid GLB buffer with InvalidGlbError', async () => {
    const invalidBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

    await expect(
      executeDownload(invalidBuffer, {
        modelName: 'Broken',
        provider: 'meshy',
      }),
    ).rejects.toThrow('Buffer is too small to be a GLB');
  });
});
