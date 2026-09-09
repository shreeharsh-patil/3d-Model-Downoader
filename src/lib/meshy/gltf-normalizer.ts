import { GLB_BIN_CHUNK_TYPE, GLB_JSON_CHUNK_TYPE, GLB_MAGIC, GLB_VERSION } from '../glb-validator';
import { logger } from '../logger';

const COMPONENT_UNSIGNED_BYTE = 5121;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const COMPONENT_FLOAT = 5126;
const KHR_MESH_QUANTIZATION = 'KHR_mesh_quantization';

type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: {
    count: number;
    indices: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
    };
    values: {
      bufferView: number;
      byteOffset?: number;
    };
  };
};

type GltfBufferView = {
  buffer?: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
};

type GltfDocument = {
  accessors?: GltfAccessor[];
  buffers?: Array<{ byteLength: number }>;
  bufferViews?: GltfBufferView[];
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string }>;
  textures?: Array<{ source?: number; sampler?: number }>;
  materials?: Array<Record<string, unknown>>;
  meshes?: Array<{
    primitives?: Array<{
      attributes?: Record<string, number>;
      targets?: Array<Record<string, number>>;
      material?: number;
    }>;
  }>;
  animations?: Array<Record<string, unknown>>;
  skins?: Array<Record<string, unknown>>;
  nodes?: Array<Record<string, unknown>>;
  scenes?: Array<Record<string, unknown>>;
  scene?: number;
  [key: string]: unknown;
};

export type GlbChunk = {
  type: number;
  data: Uint8Array;
};

export function align4(value: number): number {
  return (value + 3) & ~3;
}

export function parseGlb(buffer: ArrayBuffer): { gltf: GltfDocument; bin: Uint8Array; chunks: GlbChunk[] } | null {
  if (buffer.byteLength < 20) return null;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION) return null;

  const declaredLength = view.getUint32(8, true);
  if (declaredLength > buffer.byteLength) return null;

  const chunks: GlbChunk[] = [];
  let offset = 12;
  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > declaredLength) return null;

    chunks.push({ type: chunkType, data: new Uint8Array(buffer, chunkStart, chunkLength) });
    offset = chunkEnd;
  }

  const jsonChunk = chunks.find((chunk) => chunk.type === GLB_JSON_CHUNK_TYPE);
  const binChunk = chunks.find((chunk) => chunk.type === GLB_BIN_CHUNK_TYPE);
  if (!jsonChunk || !binChunk) return null;

  try {
    const jsonText = new TextDecoder()
      .decode(jsonChunk.data)
      .replace(/[\u0000\s]+$/u, '');

    return {
      gltf: JSON.parse(jsonText) as GltfDocument,
      bin: binChunk.data,
      chunks,
    };
  } catch {
    return null;
  }
}

export function buildGlb(gltf: GltfDocument, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedJsonLength = align4(jsonBytes.byteLength);
  const paddedBinLength = align4(bin.byteLength);
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);

  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);
  bytes.fill(0x20, 20, 20 + paddedJsonLength);
  bytes.set(jsonBytes, 20);

  const binHeaderOffset = 20 + paddedJsonLength;
  view.setUint32(binHeaderOffset, paddedBinLength, true);
  view.setUint32(binHeaderOffset + 4, GLB_BIN_CHUNK_TYPE, true);
  bytes.set(bin, binHeaderOffset + 8);

  return output;
}

function getComponentCount(type: string): number {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT2': return 4;
    case 'MAT3': return 9;
    case 'MAT4': return 16;
    default: return 0;
  }
}

function getComponentByteSize(componentType: number): number {
  switch (componentType) {
    case 5120:
    case COMPONENT_UNSIGNED_BYTE:
      return 1;
    case 5122:
    case COMPONENT_UNSIGNED_SHORT:
      return 2;
    case COMPONENT_UNSIGNED_INT:
    case COMPONENT_FLOAT:
      return 4;
    default:
      return 0;
  }
}

function readUnsignedIndex(view: DataView, byteOffset: number, componentType: number): number | undefined {
  switch (componentType) {
    case COMPONENT_UNSIGNED_BYTE:
      return view.getUint8(byteOffset);
    case COMPONENT_UNSIGNED_SHORT:
      return view.getUint16(byteOffset, true);
    case COMPONENT_UNSIGNED_INT:
      return view.getUint32(byteOffset, true);
    default:
      return undefined;
  }
}

function readUnsignedShortAccessorAsFloats(gltf: GltfDocument, bin: Uint8Array, accessor: GltfAccessor) {
  const bufferView = accessor.bufferView != null ? gltf.bufferViews?.[accessor.bufferView] : undefined;
  const componentCount = getComponentCount(accessor.type);
  const componentByteSize = getComponentByteSize(accessor.componentType);
  if (!bufferView || componentCount === 0 || componentByteSize === 0) return null;
  if (accessor.componentType !== COMPONENT_UNSIGNED_SHORT) return null;

  const output = new Float32Array(accessor.count * componentCount);
  const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? componentCount * componentByteSize;
  const min = new Array(componentCount).fill(Number.POSITIVE_INFINITY);
  const max = new Array(componentCount).fill(Number.NEGATIVE_INFINITY);
  const decode = accessor.normalized ? (value: number) => value / 65535 : (value: number) => value;

  for (let elementIndex = 0; elementIndex < accessor.count; elementIndex += 1) {
    const elementOffset = baseOffset + elementIndex * stride;
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      const value = decode(binView.getUint16(elementOffset + componentIndex * componentByteSize, true));
      output[elementIndex * componentCount + componentIndex] = value;
    }
  }

  if (accessor.sparse) {
    const indicesView = gltf.bufferViews?.[accessor.sparse.indices.bufferView];
    const valuesView = gltf.bufferViews?.[accessor.sparse.values.bufferView];
    const indexByteSize = getComponentByteSize(accessor.sparse.indices.componentType);
    if (!indicesView || !valuesView || indexByteSize === 0) return null;

    const indicesBaseOffset = (indicesView.byteOffset ?? 0) + (accessor.sparse.indices.byteOffset ?? 0);
    const valuesBaseOffset = (valuesView.byteOffset ?? 0) + (accessor.sparse.values.byteOffset ?? 0);
    const valuesStride = valuesView.byteStride ?? componentCount * componentByteSize;

    for (let sparseIndex = 0; sparseIndex < accessor.sparse.count; sparseIndex += 1) {
      const elementIndex = readUnsignedIndex(
        binView,
        indicesBaseOffset + sparseIndex * indexByteSize,
        accessor.sparse.indices.componentType,
      );
      if (elementIndex == null || elementIndex >= accessor.count) return null;

      const valueOffset = valuesBaseOffset + sparseIndex * valuesStride;
      for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
        output[elementIndex * componentCount + componentIndex] = decode(
          binView.getUint16(valueOffset + componentIndex * componentByteSize, true),
        );
      }
    }
  }

  for (let elementIndex = 0; elementIndex < accessor.count; elementIndex += 1) {
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      const value = output[elementIndex * componentCount + componentIndex];
      min[componentIndex] = Math.min(min[componentIndex], value);
      max[componentIndex] = Math.max(max[componentIndex], value);
    }
  }

  return { data: new Uint8Array(output.buffer), min, max };
}

function getPositionAccessorIndices(gltf: GltfDocument) {
  const indices = new Set<number>();
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const position = primitive.attributes?.POSITION;
      if (typeof position === 'number') indices.add(position);
    }
  }
  return indices;
}

function stripExtension(list: string[] | undefined, extensionName: string) {
  if (!list) return undefined;
  const next = list.filter((extension) => extension !== extensionName);
  return next.length > 0 ? next : undefined;
}

function hasQuantizedMeshAttributes(gltf: GltfDocument) {
  function dependsOnExtension(semantic: string, accessorIndex: number): boolean {
    const accessor = gltf.accessors?.[accessorIndex];
    if (!accessor || accessor.componentType === COMPONENT_FLOAT) return false;
    if (semantic === 'JOINTS_0' || semantic === 'JOINTS_1') {
      return ![COMPONENT_UNSIGNED_BYTE, COMPONENT_UNSIGNED_SHORT].includes(accessor.componentType);
    }
    if (semantic === 'WEIGHTS_0' || semantic === 'WEIGHTS_1') {
      return ![COMPONENT_UNSIGNED_BYTE, COMPONENT_UNSIGNED_SHORT].includes(accessor.componentType) || !accessor.normalized;
    }
    if (/^(TEXCOORD_|COLOR_)/.test(semantic)) {
      return ![COMPONENT_UNSIGNED_BYTE, COMPONENT_UNSIGNED_SHORT].includes(accessor.componentType) || !accessor.normalized;
    }
    return true;
  }

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes ?? {})) {
        if (dependsOnExtension(semantic, accessorIndex)) return true;
      }
      for (const target of primitive.targets ?? []) {
        for (const [semantic, accessorIndex] of Object.entries(target)) {
          if (dependsOnExtension(semantic, accessorIndex)) return true;
        }
      }
    }
  }
  return false;
}

function hasQuantizedAttributesOrAnimations(gltf: GltfDocument): boolean {
  if (hasQuantizedMeshAttributes(gltf)) return true;
  if (Array.isArray(gltf.animations)) {
    for (const anim of gltf.animations as Array<{ samplers?: Array<{ output?: number }> }>) {
      for (const sampler of anim?.samplers ?? []) {
        if (typeof sampler?.output === 'number') {
          const acc = gltf.accessors?.[sampler.output];
          if (acc && acc.componentType !== COMPONENT_FLOAT) return true;
        }
      }
    }
  }
  return false;
}

export function normalizeQuantizedPositionsInGlb(buffer: ArrayBuffer): ArrayBuffer {
  try {
    const parsed = parseGlb(buffer);
    if (!parsed) return buffer;

    const { gltf, bin } = parsed;
    const accessors = gltf.accessors ?? [];
    const bufferViews = gltf.bufferViews ?? [];
    const positionAccessorIndices = getPositionAccessorIndices(gltf);
    const appendedChunks: Uint8Array[] = [];
    let appendedByteLength = 0;
    let convertedCount = 0;

    for (const accessorIndex of positionAccessorIndices) {
      const accessor = accessors[accessorIndex];
      if (!accessor || accessor.componentType !== COMPONENT_UNSIGNED_SHORT || accessor.type !== 'VEC3') continue;

      const converted = readUnsignedShortAccessorAsFloats(gltf, bin, accessor);
      if (!converted) continue;

      const byteOffset = align4(bin.byteLength + appendedByteLength);
      const paddingLength = byteOffset - (bin.byteLength + appendedByteLength);
      if (paddingLength > 0) {
        appendedChunks.push(new Uint8Array(paddingLength));
        appendedByteLength += paddingLength;
      }

      appendedChunks.push(converted.data);
      appendedByteLength += converted.data.byteLength;

      const sourceBufferView = accessor.bufferView != null ? bufferViews[accessor.bufferView] : undefined;
      const nextBufferViewIndex = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset,
        byteLength: converted.data.byteLength,
        target: sourceBufferView?.target,
      });

      accessor.bufferView = nextBufferViewIndex;
      accessor.byteOffset = 0;
      accessor.componentType = COMPONENT_FLOAT;
      delete accessor.normalized;
      accessor.min = converted.min;
      accessor.max = converted.max;
      delete accessor.sparse;

      convertedCount += 1;
    }

    if (convertedCount === 0) return buffer;

    const nextBin = new Uint8Array(bin.byteLength + appendedByteLength);
    nextBin.set(bin, 0);
    let writeOffset = bin.byteLength;
    for (const chunk of appendedChunks) {
      nextBin.set(chunk, writeOffset);
      writeOffset += chunk.byteLength;
    }

    gltf.bufferViews = bufferViews;
    gltf.buffers ??= [{ byteLength: 0 }];
    gltf.buffers[0].byteLength = nextBin.byteLength;
    if (!hasQuantizedAttributesOrAnimations(gltf)) {
      gltf.extensionsRequired = stripExtension(gltf.extensionsRequired, KHR_MESH_QUANTIZATION);
      gltf.extensionsUsed = stripExtension(gltf.extensionsUsed, KHR_MESH_QUANTIZATION);
    }

    logger.debug('MeshyNormalizer', `Normalized ${convertedCount} quantized POSITION accessors to FLOAT`);
    return buildGlb(gltf, nextBin);
  } catch (error) {
    logger.warn('MeshyNormalizer', 'Failed to normalize quantized GLB positions', error);
    return buffer;
  }
}
