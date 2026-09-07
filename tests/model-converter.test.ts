import { describe, expect, it } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { convertModel, FORMAT_LABELS, FORMAT_MIME_TYPES } from '../src/lib/model-converter';

import { unzipSync } from 'fflate';

async function createSampleGlb(): Promise<ArrayBuffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor('POSITION')
    .setType('VEC3')
    .setArray(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      1, 0, 0,  1, 1, 0,  0, 1, 0,
    ]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', position);
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh);
  doc.createScene().addChild(node);

  const io = new WebIO();
  const glbBytes = await io.writeBinary(doc);
  return glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
}

async function createGlbWithTexture(): Promise<ArrayBuffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor('POSITION')
    .setType('VEC3')
    .setArray(new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,
      1, 0, 0,  1, 1, 0,  0, 1, 0,
    ]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', position);

  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const texture = doc.createTexture('Albedo')
    .setMimeType('image/png')
    .setImage(pngBytes);
  const material = doc.createMaterial('Mat')
    .setBaseColorTexture(texture);
  prim.setMaterial(material);

  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh);
  doc.createScene().addChild(node);

  const io = new WebIO();
  const glbBytes = await io.writeBinary(doc);
  return glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
}

describe('Model Converter', () => {
  it('defines valid metadata and labels for all export formats', () => {
    expect(FORMAT_MIME_TYPES.glb).toBe('model/gltf-binary');
    expect(FORMAT_MIME_TYPES.stl).toBe('model/stl');
    expect(FORMAT_MIME_TYPES.obj).toBe('model/obj');
    expect(FORMAT_MIME_TYPES.usdz).toBe('model/vnd.usdz+zip');
    expect(FORMAT_MIME_TYPES.textures).toBe('application/zip');

    expect(FORMAT_LABELS.stl.label).toBe('STL');
    expect(FORMAT_LABELS.obj.label).toBe('OBJ');
    expect(FORMAT_LABELS.usdz.label).toBe('USDZ');
    expect(FORMAT_LABELS.glb.label).toBe('GLB');
    expect(FORMAT_LABELS.textures.label).toBe('ZIP');
  });

  it('returns original GLB buffer when target format is glb', async () => {
    const glb = await createSampleGlb();
    const result = await convertModel(glb, 'glb');

    expect(result.extension).toBe('glb');
    expect(result.mimeType).toBe('model/gltf-binary');
    expect(result.byteLength).toBe(glb.byteLength);
    expect(result.buffer).toBe(glb);
  });

  it('converts GLB to binary STL format for 3D printing', async () => {
    const glb = await createSampleGlb();
    const result = await convertModel(glb, 'stl');

    expect(result.extension).toBe('stl');
    expect(result.mimeType).toBe('model/stl');
    expect(result.byteLength).toBeGreaterThan(84); // 80 byte header + 4 byte triangle count + triangles

    const view = new DataView(result.buffer);
    const triangleCount = view.getUint32(80, true);
    expect(triangleCount).toBe(2); // 2 triangles in our quad
    expect(result.byteLength).toBe(84 + 2 * 50); // 184 bytes
  });

  it('converts GLB to Wavefront OBJ format', async () => {
    const glb = await createSampleGlb();
    const result = await convertModel(glb, 'obj');

    expect(result.extension).toBe('obj');
    expect(result.mimeType).toBe('model/obj');
    expect(result.byteLength).toBeGreaterThan(0);

    const objText = new TextDecoder().decode(result.buffer);
    expect(objText).toContain('v '); // vertex definitions
    expect(objText).toContain('f '); // face definitions
  });

  it('converts GLB to Apple AR USDZ package', async () => {
    const glb = await createSampleGlb();
    const result = await convertModel(glb, 'usdz');

    expect(result.extension).toBe('usdz');
    expect(result.mimeType).toBe('model/vnd.usdz+zip');
    expect(result.byteLength).toBeGreaterThan(100);

    // USDZ is a zip archive, which begins with PK (0x50, 0x4b)
    const uint8 = new Uint8Array(result.buffer);
    expect(uint8[0]).toBe(0x50); // 'P'
    expect(uint8[1]).toBe(0x4b); // 'K'
  });

  it('extracts PBR textures to a ZIP package with README', async () => {
    const glb = await createGlbWithTexture();
    const result = await convertModel(glb, 'textures', 'SciFiRobot');

    expect(result.extension).toBe('zip');
    expect(result.mimeType).toBe('application/zip');
    expect(result.byteLength).toBeGreaterThan(100);

    // Unzip and inspect files
    const unzipped = unzipSync(new Uint8Array(result.buffer));
    const fileNames = Object.keys(unzipped);

    expect(fileNames).toContain('README.txt');
    const readmeContent = new TextDecoder().decode(unzipped['README.txt']);
    expect(readmeContent).toContain('SciFiRobot');
    expect(readmeContent).toContain('PBR Texture Pack for');
    expect(readmeContent).toContain('glTF 2.0 PBR Material Channel Guide');

    const textureFile = fileNames.find((f) => f.includes('baseColor') || f.includes('albedo'));
    expect(textureFile).toBeDefined();
    expect(textureFile).toMatch(/\.png$/i);
  });
});
