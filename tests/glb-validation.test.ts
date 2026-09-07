import { describe, expect, it } from 'vitest';
import { GLB_JSON_CHUNK_TYPE, GLB_MAGIC, GLB_VERSION, validateGlb } from '../src/lib/glb-validator';

function createValidGlbBuffer(gltfJson: Record<string, unknown> = {}): ArrayBuffer {
  const jsonStr = JSON.stringify(gltfJson);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Header
  view.setUint32(0, GLB_MAGIC, true); // "glTF"
  view.setUint32(4, GLB_VERSION, true); // 2
  view.setUint32(8, totalLength, true);

  // JSON chunk header
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);

  // Pad with spaces
  uint8.fill(0x20, 20, 20 + paddedJsonLength);
  uint8.set(jsonBytes, 20);

  return buffer;
}

describe('GLB Validation', () => {
  it('accepts a valid GLB container and parses metadata', () => {
    const gltf = {
      asset: { version: '2.0' },
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0 }, indices: 1 },
          ],
        },
      ],
      accessors: [
        { count: 300, type: 'VEC3' }, // positions
        { count: 900, type: 'SCALAR' }, // indices (300 triangles)
      ],
      materials: [{ name: 'Mat1' }, { name: 'Mat2' }],
      textures: [{ source: 0 }],
      animations: [{ name: 'Walk' }],
    };

    const buffer = createValidGlbBuffer(gltf);
    const result = validateGlb(buffer);

    expect(result.valid).toBe(true);
    expect(result.version).toBe(2);
    expect(result.metadata?.meshCount).toBe(1);
    expect(result.metadata?.triangleCount).toBe(300);
    expect(result.metadata?.vertexCount).toBe(300);
    expect(result.metadata?.materialCount).toBe(2);
    expect(result.metadata?.textureCount).toBe(1);
    expect(result.metadata?.animationCount).toBe(1);
  });

  it('rejects empty buffer', () => {
    const emptyBuffer = new ArrayBuffer(0);
    const result = validateGlb(emptyBuffer);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('rejects HTML responses (such as 404 or auth redirects)', () => {
    const html = '<!DOCTYPE html><html><body>Error 404 Not Found</body></html>';
    const buffer = new TextEncoder().encode(html).buffer;
    const result = validateGlb(buffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('HTML');
  });

  it('rejects JSON API error responses', () => {
    const errorJson = JSON.stringify({ error: 'Unauthorized', statusCode: 401 });
    const buffer = new TextEncoder().encode(errorJson).buffer;
    const result = validateGlb(buffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('JSON API error');
  });

  it('rejects PNG images pretending to be GLB', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const result = validateGlb(pngHeader.buffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('PNG');
  });

  it('rejects JPEG images pretending to be GLB', () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const result = validateGlb(jpegHeader.buffer);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('JPEG');
  });

  it('rejects truncated or corrupted GLB length', () => {
    const buffer = createValidGlbBuffer({});
    const view = new DataView(buffer);
    // Declare length larger than buffer
    view.setUint32(8, buffer.byteLength + 1000, true);

    const result = validateGlb(buffer);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('exceeds buffer');
  });

  it('rejects invalid magic header', () => {
    const buffer = createValidGlbBuffer({});
    const view = new DataView(buffer);
    view.setUint32(0, 0x12345678, true);

    const result = validateGlb(buffer);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('magic');
  });

  it('rejects unsupported GLB version', () => {
    const buffer = createValidGlbBuffer({});
    const view = new DataView(buffer);
    view.setUint32(4, 1, true); // Version 1

    const result = validateGlb(buffer);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('version');
  });
});
