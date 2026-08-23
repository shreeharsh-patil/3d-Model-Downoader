import type { GlbValidationResult, ModelMetadata } from './types';

export const GLB_MAGIC = 0x46546c67; // "glTF" in little-endian
export const GLB_VERSION = 2;
export const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"
export const GLB_BIN_CHUNK_TYPE = 0x004e4942; // "BIN\0"

export function validateGlb(buffer: ArrayBuffer): GlbValidationResult {
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    return {
      valid: false,
      reason: 'Provided data is not an ArrayBuffer',
      byteLength: 0,
    };
  }

  const byteLength = buffer.byteLength;
  if (byteLength === 0) {
    return {
      valid: false,
      reason: 'Model data is empty (0 bytes)',
      byteLength: 0,
    };
  }

  // Check for common non-GLB response types by inspecting initial ASCII/bytes
  const headBytes = new Uint8Array(buffer, 0, Math.min(byteLength, 64));
  const headText = String.fromCharCode(...Array.from(headBytes));

  if (/^\s*<!DOCTYPE|^\s*<html|^\s*<head/i.test(headText)) {
    return {
      valid: false,
      reason: 'Server returned an HTML page instead of a 3D model (e.g. 404 or auth redirect)',
      byteLength,
    };
  }

  if (/^\s*\{\s*"(?:error|message|statusCode|code|status)"/i.test(headText)) {
    return {
      valid: false,
      reason: 'Server returned a JSON API error instead of a 3D model',
      byteLength,
    };
  }

  // Check PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (headBytes[0] === 0x89 && headBytes[1] === 0x50 && headBytes[2] === 0x4e && headBytes[3] === 0x47) {
    return {
      valid: false,
      reason: 'Response was a PNG image instead of a GLB model',
      byteLength,
    };
  }

  // Check JPEG magic: FF D8 FF
  if (headBytes[0] === 0xff && headBytes[1] === 0xd8 && headBytes[2] === 0xff) {
    return {
      valid: false,
      reason: 'Response was a JPEG image instead of a GLB model',
      byteLength,
    };
  }

  if (byteLength < 20) {
    return {
      valid: false,
      reason: `Buffer is too small to be a GLB (${byteLength} bytes, minimum is 20 bytes)`,
      byteLength,
    };
  }

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    const magicChars = [
      String.fromCharCode(view.getUint8(0)),
      String.fromCharCode(view.getUint8(1)),
      String.fromCharCode(view.getUint8(2)),
      String.fromCharCode(view.getUint8(3)),
    ].join('');
    return {
      valid: false,
      reason: `Invalid GLB magic header (expected "glTF", got "${magicChars}")`,
      byteLength,
    };
  }

  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) {
    return {
      valid: false,
      reason: `Unsupported GLB version: ${version} (only version 2 is supported)`,
      byteLength,
      version,
    };
  }

  const declaredLength = view.getUint32(8, true);
  if (declaredLength > byteLength) {
    return {
      valid: false,
      reason: `Corrupted file: declared GLB length (${declaredLength} bytes) exceeds buffer (${byteLength} bytes)`,
      byteLength,
      version,
    };
  }

  const firstChunkLength = view.getUint32(12, true);
  const firstChunkType = view.getUint32(16, true);
  if (firstChunkType !== GLB_JSON_CHUNK_TYPE) {
    return {
      valid: false,
      reason: 'First chunk in GLB container must be JSON chunk',
      byteLength,
      version,
    };
  }

  if (12 + 8 + firstChunkLength > byteLength) {
    return {
      valid: false,
      reason: `JSON chunk declared length (${firstChunkLength} bytes) exceeds buffer`,
      byteLength,
      version,
    };
  }

  let metadata: ModelMetadata = {};
  try {
    const jsonBytes = new Uint8Array(buffer, 20, firstChunkLength);
    const jsonText = new TextDecoder().decode(jsonBytes).replace(/[\u0000\s]+$/u, '');
    const gltf = JSON.parse(jsonText);

    let triangleCount = 0;
    let vertexCount = 0;
    let primitiveCount = 0;
    let hasMorphTargets = false;

    if (Array.isArray(gltf.meshes)) {
      for (const mesh of gltf.meshes) {
        if (!mesh || !Array.isArray(mesh.primitives)) continue;
        for (const prim of mesh.primitives) {
          primitiveCount += 1;
          if (prim.targets && prim.targets.length > 0) {
            hasMorphTargets = true;
          }

          if (prim.indices !== undefined && Array.isArray(gltf.accessors)) {
            const indexAccessor = gltf.accessors[prim.indices];
            if (indexAccessor && typeof indexAccessor.count === 'number') {
              triangleCount += Math.floor(indexAccessor.count / 3);
            }
          }

          if (prim.attributes && prim.attributes.POSITION !== undefined && Array.isArray(gltf.accessors)) {
            const posAccessor = gltf.accessors[prim.attributes.POSITION];
            if (posAccessor && typeof posAccessor.count === 'number') {
              vertexCount += posAccessor.count;
            }
          }
        }
      }
    }

    metadata = {
      meshCount: Array.isArray(gltf.meshes) ? gltf.meshes.length : 0,
      primitiveCount: primitiveCount > 0 ? primitiveCount : undefined,
      triangleCount: triangleCount > 0 ? triangleCount : undefined,
      vertexCount: vertexCount > 0 ? vertexCount : undefined,
      materialCount: Array.isArray(gltf.materials) ? gltf.materials.length : 0,
      textureCount: Array.isArray(gltf.textures) ? gltf.textures.length : 0,
      animationCount: Array.isArray(gltf.animations) ? gltf.animations.length : 0,
      skinCount: Array.isArray(gltf.skins) ? gltf.skins.length : 0,
      hasMorphTargets,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Failed to parse GLB JSON chunk: ${error instanceof Error ? error.message : String(error)}`,
      byteLength,
      version,
    };
  }

  return {
    valid: true,
    byteLength,
    version,
    metadata,
  };
}
