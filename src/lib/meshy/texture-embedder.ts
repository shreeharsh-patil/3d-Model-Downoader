import { align4, buildGlb, parseGlb } from './gltf-normalizer';
import { logger } from '../logger';

export function glbHasEmbeddedTextures(buffer: ArrayBuffer): boolean {
  try {
    const parsed = parseGlb(buffer);
    return (parsed?.gltf.textures?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export function looksLikePng(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const bytes = new Uint8Array(buffer, 0, 8);
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export async function fetchTexturePng(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Failed to fetch texture (${response.status} ${response.statusText}).`);
  }
  const buffer = await response.arrayBuffer();
  if (!looksLikePng(buffer)) {
    throw new Error('Fetched texture is not a valid PNG.');
  }
  return new Uint8Array(buffer);
}

export function embedTextureInGlb(glbBuffer: ArrayBuffer, texturePng: Uint8Array): ArrayBuffer | null {
  try {
    const parsed = parseGlb(glbBuffer);
    if (!parsed) return null;

    const { gltf, bin } = parsed;

    // Append the PNG bytes to the BIN chunk (4-byte aligned).
    const byteOffset = align4(bin.byteLength);
    const paddedTextureLength = align4(texturePng.byteLength);
    const nextBin = new Uint8Array(byteOffset + paddedTextureLength);
    nextBin.set(bin, 0);
    nextBin.set(texturePng, byteOffset);

    const bufferViews = gltf.bufferViews ?? [];
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: texturePng.byteLength,
    });
    gltf.bufferViews = bufferViews;

    const images = gltf.images ?? [];
    images.push({ bufferView: bufferViews.length - 1, mimeType: 'image/png' });
    gltf.images = images;

    const textures = gltf.textures ?? [];
    textures.push({ source: images.length - 1 });
    gltf.textures = textures;
    const textureIndex = textures.length - 1;

    const materials = (gltf.materials as Array<Record<string, unknown>>) ?? [];
    let newMaterialIndex: number | undefined;

    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        if (primitive.material == null) {
          if (newMaterialIndex == null) {
            materials.push({
              name: 'texture',
              pbrMetallicRoughness: {
                baseColorTexture: { index: textureIndex },
                metallicFactor: 0,
                roughnessFactor: 1,
              },
            });
            newMaterialIndex = materials.length - 1;
          }
          primitive.material = newMaterialIndex;
        } else {
          const material = materials[primitive.material] as
            | { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }
            | undefined;
          if (material) {
            material.pbrMetallicRoughness ??= {};
            material.pbrMetallicRoughness.baseColorTexture = { index: textureIndex };
          }
        }
      }
    }
    gltf.materials = materials;

    gltf.buffers ??= [{ byteLength: 0 }];
    gltf.buffers[0].byteLength = nextBin.byteLength;

    logger.debug('TextureEmbedder', 'Successfully embedded PNG texture into GLB');
    return buildGlb(gltf, nextBin);
  } catch (error) {
    logger.warn('TextureEmbedder', 'Failed to embed texture into GLB', error);
    return null;
  }
}
