import type { GlbValidationResult, ModelMetadata } from './types';

export const GLB_MAGIC = 0x46546c67;
export const GLB_VERSION = 2;
export const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
export const GLB_BIN_CHUNK_TYPE = 0x004e4942;

const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/ktx2', 'image/avif']);
type JsonObject = Record<string, unknown>;

function fail(reason: string, byteLength: number, version?: number): GlbValidationResult {
  return { valid: false, reason, byteLength, version };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validateIndex(value: unknown, length: number, label: string): string | undefined {
  return !integer(value) || value >= length ? `${label} references an out-of-range index.` : undefined;
}

function accessorByteSize(accessor: JsonObject): number | undefined {
  const bytes = COMPONENT_BYTES[accessor.componentType as number];
  const components = TYPE_COMPONENTS[accessor.type as string];
  return bytes && components ? bytes * components : undefined;
}

function validateDocument(gltf: JsonObject, binByteLength: number): { reason?: string; metadata?: ModelMetadata } {
  if (!isObject(gltf.asset) || typeof gltf.asset.version !== 'string' || !gltf.asset.version.startsWith('2.')) {
    return { reason: 'GLB JSON must declare glTF asset version 2.x.' };
  }

  const buffers = Array.isArray(gltf.buffers) ? gltf.buffers : [];
  const bufferViews = Array.isArray(gltf.bufferViews) ? gltf.bufferViews : [];
  const accessors = Array.isArray(gltf.accessors) ? gltf.accessors : [];
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const materials = Array.isArray(gltf.materials) ? gltf.materials : [];
  const textures = Array.isArray(gltf.textures) ? gltf.textures : [];
  const images = Array.isArray(gltf.images) ? gltf.images : [];
  const samplers = Array.isArray(gltf.samplers) ? gltf.samplers : [];

  if (meshes.length === 0) return { reason: 'GLB does not contain any meshes.' };
  if (buffers.length > 0) {
    const embedded = buffers[0];
    if (!isObject(embedded) || !integer(embedded.byteLength) || embedded.byteLength > binByteLength) {
      return { reason: 'Embedded buffer length exceeds the GLB BIN chunk.' };
    }
  } else if (binByteLength > 0) {
    return { reason: 'GLB has a BIN chunk but no matching buffer declaration.' };
  }

  for (let index = 0; index < bufferViews.length; index += 1) {
    const item = bufferViews[index];
    if (!isObject(item) || !integer(item.byteLength)) return { reason: `bufferView ${index} is malformed.` };
    const bufferIndex = item.buffer ?? 0;
    if (!integer(bufferIndex) || bufferIndex >= Math.max(buffers.length, 1)) return { reason: `bufferView ${index} references an invalid buffer.` };
    const offset = integer(item.byteOffset) ? item.byteOffset : 0;
    const embedded = buffers[bufferIndex];
    const available = isObject(embedded) && integer(embedded.byteLength) ? embedded.byteLength : binByteLength;
    if (offset + item.byteLength > available) return { reason: `bufferView ${index} exceeds its buffer bounds.` };
    if (item.byteStride !== undefined && (!integer(item.byteStride) || item.byteStride < 4 || item.byteStride > 252)) {
      return { reason: `bufferView ${index} has an invalid byteStride.` };
    }
  }

  for (let index = 0; index < accessors.length; index += 1) {
    const accessor = accessors[index];
    if (!isObject(accessor) || !integer(accessor.count) || accessorByteSize(accessor) === undefined) return { reason: `accessor ${index} is malformed.` };
    if (accessor.bufferView !== undefined) {
      const indexError = validateIndex(accessor.bufferView, bufferViews.length, `accessor ${index}`);
      if (indexError) return { reason: indexError };
      const view = bufferViews[accessor.bufferView as number] as JsonObject;
      const elementSize = accessorByteSize(accessor)!;
      const stride = integer(view.byteStride) ? view.byteStride : elementSize;
      const offset = integer(accessor.byteOffset) ? accessor.byteOffset : 0;
      const required = accessor.count === 0 ? offset : offset + (accessor.count - 1) * stride + elementSize;
      if (required > (view.byteLength as number)) return { reason: `accessor ${index} exceeds bufferView bounds.` };
    }
    // An accessor without a bufferView is valid glTF and is initialized to
    // zeroes (with optional sparse values applied on top).
    if (accessor.sparse !== undefined) {
      const sparse = accessor.sparse;
      if (!isObject(sparse) || !integer(sparse.count) || sparse.count > accessor.count || !isObject(sparse.indices) || !isObject(sparse.values)) {
        return { reason: `accessor ${index} has malformed sparse data.` };
      }
      const indicesError = validateIndex(sparse.indices.bufferView, bufferViews.length, `accessor ${index} sparse indices`);
      const valuesError = validateIndex(sparse.values.bufferView, bufferViews.length, `accessor ${index} sparse values`);
      if (indicesError || valuesError) return { reason: indicesError ?? valuesError };
      if (![5121, 5123, 5125].includes(sparse.indices.componentType as number)) return { reason: `accessor ${index} sparse indices use an invalid component type.` };
    }
  }

  let primitiveCount = 0;
  let triangleCount = 0;
  let vertexCount = 0;
  let hasMorphTargets = false;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex];
    if (!isObject(mesh) || !Array.isArray(mesh.primitives) || mesh.primitives.length === 0) return { reason: `mesh ${meshIndex} has no valid primitives.` };
    for (const primitive of mesh.primitives) {
      if (!isObject(primitive) || !isObject(primitive.attributes) || Object.keys(primitive.attributes).length === 0) return { reason: `mesh ${meshIndex} contains a primitive without attributes.` };
      primitiveCount += 1;
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
        const error = validateIndex(accessorIndex, accessors.length, `mesh ${meshIndex} attribute ${semantic}`);
        if (error) return { reason: error };
      }
      if (primitive.indices !== undefined) {
        const error = validateIndex(primitive.indices, accessors.length, `mesh ${meshIndex} indices`);
        if (error) return { reason: error };
        triangleCount += Math.floor((((accessors[primitive.indices as number] as JsonObject).count as number) ?? 0) / 3);
      }
      const positionIndex = primitive.attributes.POSITION;
      if (integer(positionIndex)) vertexCount += ((accessors[positionIndex] as JsonObject).count as number) ?? 0;
      if (primitive.material !== undefined) {
        const error = validateIndex(primitive.material, materials.length, `mesh ${meshIndex} material`);
        if (error) return { reason: error };
      }
      if (Array.isArray(primitive.targets)) {
        hasMorphTargets ||= primitive.targets.length > 0;
        for (const target of primitive.targets) {
          if (!isObject(target)) return { reason: `mesh ${meshIndex} contains a malformed morph target.` };
          for (const [semantic, accessorIndex] of Object.entries(target)) {
            const error = validateIndex(accessorIndex, accessors.length, `morph target ${semantic}`);
            if (error) return { reason: error };
          }
        }
      }
    }
  }

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (!isObject(image)) return { reason: `image ${index} is malformed.` };
    if (image.bufferView !== undefined) {
      const error = validateIndex(image.bufferView, bufferViews.length, `image ${index}`);
      if (error) return { reason: error };
      if (typeof image.mimeType !== 'string' || !IMAGE_MIME_TYPES.has(image.mimeType.toLowerCase())) return { reason: `image ${index} has an unsupported or missing MIME type.` };
    } else if (typeof image.uri !== 'string' || image.uri.length === 0) return { reason: `image ${index} has neither a bufferView nor a URI.` };
  }
  for (let index = 0; index < textures.length; index += 1) {
    const texture = textures[index];
    if (!isObject(texture)) return { reason: `texture ${index} is malformed.` };
    if (texture.source !== undefined) {
      const error = validateIndex(texture.source, images.length, `texture ${index} source`);
      if (error) return { reason: error };
    }
    if (texture.sampler !== undefined) {
      const error = validateIndex(texture.sampler, samplers.length, `texture ${index} sampler`);
      if (error) return { reason: error };
    }
  }

  const used = Array.isArray(gltf.extensionsUsed) ? gltf.extensionsUsed : [];
  const required = Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired : [];
  if (!used.every((item) => typeof item === 'string') || !required.every((item) => typeof item === 'string')) return { reason: 'Extension declarations must contain only strings.' };
  for (const extension of required) if (!used.includes(extension)) return { reason: `Required extension ${extension} is not declared in extensionsUsed.` };

  return { metadata: {
    meshCount: meshes.length,
    primitiveCount,
    vertexCount: vertexCount || undefined,
    triangleCount: triangleCount || undefined,
    materialCount: materials.length,
    textureCount: textures.length,
    animationCount: Array.isArray(gltf.animations) ? gltf.animations.length : 0,
    skinCount: Array.isArray(gltf.skins) ? gltf.skins.length : 0,
    hasMorphTargets,
  } };
}

export function validateGlb(buffer: ArrayBuffer): GlbValidationResult {
  if (!(buffer instanceof ArrayBuffer)) return fail('Provided data is not an ArrayBuffer', 0);
  const byteLength = buffer.byteLength;
  if (byteLength === 0) return fail('Model data is empty (0 bytes)', 0);
  const head = new Uint8Array(buffer, 0, Math.min(byteLength, 64));
  const text = new TextDecoder().decode(head);
  if (/^\s*<!DOCTYPE|^\s*<html|^\s*<head/i.test(text)) return fail('Server returned an HTML page instead of a 3D model.', byteLength);
  if (/^\s*\{\s*"(?:error|message|statusCode|code|status)"/i.test(text)) return fail('Server returned a JSON API error instead of a 3D model.', byteLength);
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return fail('Response was a PNG image instead of a GLB model.', byteLength);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return fail('Response was a JPEG image instead of a GLB model.', byteLength);
  if (byteLength < 20) return fail(`Buffer is too small to be a GLB (${byteLength} bytes).`, byteLength);

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return fail('Invalid GLB magic header (expected "glTF").', byteLength);
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) return fail(`Unsupported GLB version: ${version}.`, byteLength, version);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > byteLength) return fail(`Corrupted file: declared GLB length (${declaredLength} bytes) exceeds buffer (${byteLength} bytes).`, byteLength, version);
  if (declaredLength < byteLength) return fail(`Corrupted file: declared GLB length (${declaredLength} bytes) is smaller than buffer (${byteLength} bytes).`, byteLength, version);

  let offset = 12;
  let chunkIndex = 0;
  let json: JsonObject | undefined;
  let binByteLength = 0;
  while (offset < declaredLength) {
    if (offset + 8 > declaredLength) return fail('GLB contains a truncated chunk header.', byteLength, version);
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0) return fail(`GLB chunk ${chunkIndex} is not 4-byte aligned.`, byteLength, version);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > declaredLength) return fail(`GLB chunk ${chunkIndex} exceeds file bounds.`, byteLength, version);
    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK_TYPE) return fail('First chunk in GLB container must be JSON.', byteLength, version);
    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      if (json) return fail('GLB contains more than one JSON chunk.', byteLength, version);
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, start, chunkLength)).replace(/[\u0000\s]+$/u, '');
        const parsed: unknown = JSON.parse(decoded);
        if (!isObject(parsed)) return fail('GLB JSON chunk is not an object.', byteLength, version);
        json = parsed;
      } catch (error) {
        return fail(`Failed to parse GLB JSON chunk: ${error instanceof Error ? error.message : String(error)}`, byteLength, version);
      }
    } else if (chunkType === GLB_BIN_CHUNK_TYPE) {
      if (binByteLength > 0) return fail('GLB contains more than one BIN chunk.', byteLength, version);
      binByteLength = chunkLength;
    }
    offset = end;
    chunkIndex += 1;
  }
  if (!json) return fail('GLB does not contain a JSON chunk.', byteLength, version);
  const result = validateDocument(json, binByteLength);
  return result.reason ? fail(result.reason, byteLength, version) : { valid: true, byteLength, version, metadata: result.metadata };
}
