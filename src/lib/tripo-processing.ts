import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { InvalidGlbError, NetworkError, ProcessingError } from './errors';
import { sanitizeFilename } from './filename';
import { dequantize } from './gltf-dequantize';
import { GLB_JSON_CHUNK_TYPE, validateGlb } from './glb-validator';
import { logger } from './logger';
import { getProviderById } from './providers/registry';
import { tripoProvider } from './providers/tripo/tripo-provider';
import type { WebsiteId } from './types';

const EXT_MESHOPT_COMPRESSION = 'EXT_meshopt_compression';
const KHR_MESH_QUANTIZATION = 'KHR_mesh_quantization';

type GlbSummary = {
  extensionsRequired: string[];
  extensionsUsed: string[];
  meshCount: number;
  materialCount: number;
  textureCount: number;
};

export type TripoProcessingResult = {
  buffer: ArrayBuffer;
  byteLength: number;
  filename: string;
  validation: {
    validGlb: boolean;
    meshCount: number;
    materialCount: number;
    textureCount: number;
    removedRequiredExtensions: boolean;
    sourceHadMaterials: boolean;
    sourceHadTextures: boolean;
    outputHasSourceMaterials: boolean;
    outputHasSourceTextures: boolean;
  };
};

function parseGlbSummary(buffer: ArrayBuffer): GlbSummary {
  const validation = validateGlb(buffer);
  if (!validation.valid) {
    throw new InvalidGlbError(validation.reason ?? 'Invalid GLB');
  }

  const view = new DataView(buffer);
  const declaredLength = view.getUint32(8, true);
  let offset = 12;

  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      const jsonText = new TextDecoder()
        .decode(new Uint8Array(buffer, chunkStart, chunkLength))
        .replace(/[\u0000\s]+$/u, '');
      const gltf = JSON.parse(jsonText) as {
        extensionsRequired?: string[];
        extensionsUsed?: string[];
        materials?: unknown[];
        meshes?: unknown[];
        textures?: unknown[];
      };

      return {
        extensionsRequired: gltf.extensionsRequired ?? [],
        extensionsUsed: gltf.extensionsUsed ?? [],
        meshCount: gltf.meshes?.length ?? 0,
        materialCount: gltf.materials?.length ?? 0,
        textureCount: gltf.textures?.length ?? 0,
      };
    }
    offset = chunkEnd;
  }

  throw new InvalidGlbError('GLB does not contain a JSON chunk');
}

function makeTripoFilename(url: string, modelName?: string, providerId: WebsiteId = 'tripo') {
  if (modelName) {
    return sanitizeFilename(modelName, providerId, 'glb');
  }
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split('/').pop() ?? `${providerId}_model.glb`;
    if (filename.endsWith('_meshopt.glb')) {
      return filename.replace(/_meshopt\.glb$/u, '_cleaned.glb');
    }
    if (filename.endsWith('.glb')) {
      return filename.replace(/\.glb$/u, '_cleaned.glb');
    }
  } catch {
    // fallback below
  }
  return sanitizeFilename(undefined, providerId, 'glb');
}

export async function processTripoGlb(
  url: string,
  modelName?: string,
  providerId: WebsiteId = 'tripo',
): Promise<TripoProcessingResult> {
  const provider = getProviderById(providerId) ?? tripoProvider;
  if (!provider.isModelAsset(url)) {
    throw new ProcessingError(`Refusing to process a non-${provider.label} model URL.`);
  }

  logger.info(provider.label, `Fetching ${provider.label} GLB asset...`, url);
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit' });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : String(err));
  }

  if (!response.ok) {
    throw new NetworkError(`HTTP ${response.status} ${response.statusText}`);
  }

  const sourceBuffer = await response.arrayBuffer();
  const sourceSummary = parseGlbSummary(sourceBuffer);

  const hasMeshopt =
    sourceSummary.extensionsRequired.includes(EXT_MESHOPT_COMPRESSION) ||
    sourceSummary.extensionsUsed.includes(EXT_MESHOPT_COMPRESSION);
  const hasQuantization =
    sourceSummary.extensionsRequired.includes(KHR_MESH_QUANTIZATION) ||
    sourceSummary.extensionsUsed.includes(KHR_MESH_QUANTIZATION);

  // If the GLB does not have meshopt or quantization, return the original verified GLB directly
  if (!hasMeshopt && !hasQuantization) {
    logger.info(provider.label, `${provider.label} GLB is already standard uncompressed; bypassing decompression`);
    return {
      buffer: sourceBuffer,
      byteLength: sourceBuffer.byteLength,
      filename: makeTripoFilename(url, modelName, providerId),
      validation: {
        validGlb: true,
        meshCount: sourceSummary.meshCount,
        materialCount: sourceSummary.materialCount,
        textureCount: sourceSummary.textureCount,
        removedRequiredExtensions: true,
        sourceHadMaterials: sourceSummary.materialCount > 0,
        sourceHadTextures: sourceSummary.textureCount > 0,
        outputHasSourceMaterials: true,
        outputHasSourceTextures: true,
      },
    };
  }

  try {
    await MeshoptDecoder.ready;
  } catch (err) {
    throw new ProcessingError(`Failed to initialize MeshoptDecoder: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

    const document = await io.readBinary(new Uint8Array(sourceBuffer));
    await document.transform(dequantize());

    const meshoptExtension = document
      .getRoot()
      .listExtensionsUsed()
      .find((extension) => extension.extensionName === EXTMeshoptCompression.EXTENSION_NAME);
    meshoptExtension?.dispose();

    const quantizationExtension = document
      .getRoot()
      .listExtensionsUsed()
      .find((extension) => extension.extensionName === KHRMeshQuantization.EXTENSION_NAME);
    quantizationExtension?.dispose();

    const outputBytes = await io.writeBinary(document);
    const outputBuffer = outputBytes.buffer.slice(
      outputBytes.byteOffset,
      outputBytes.byteOffset + outputBytes.byteLength,
    );
    const outputSummary = parseGlbSummary(outputBuffer);
    const removedRequiredExtensions =
      !outputSummary.extensionsRequired.includes(EXT_MESHOPT_COMPRESSION) &&
      !outputSummary.extensionsRequired.includes(KHR_MESH_QUANTIZATION);
    const validGlb = outputSummary.meshCount > 0 && removedRequiredExtensions;

    if (!validGlb) {
      throw new ProcessingError('Cleaned Tripo3D GLB validation failed.');
    }

    logger.info('Tripo', 'Tripo3D GLB cleaned and dequantized successfully', {
      sourceByteLength: sourceBuffer.byteLength,
      outputByteLength: outputBuffer.byteLength,
      meshCount: outputSummary.meshCount,
    });

    return {
      buffer: outputBuffer,
      byteLength: outputBuffer.byteLength,
      filename: makeTripoFilename(url, modelName, providerId),
      validation: {
        validGlb,
        meshCount: outputSummary.meshCount,
        materialCount: outputSummary.materialCount,
        textureCount: outputSummary.textureCount,
        removedRequiredExtensions,
        sourceHadMaterials: sourceSummary.materialCount > 0,
        sourceHadTextures: sourceSummary.textureCount > 0,
        outputHasSourceMaterials: sourceSummary.materialCount === 0 || outputSummary.materialCount > 0,
        outputHasSourceTextures: sourceSummary.textureCount === 0 || outputSummary.textureCount > 0,
      },
    };
  } catch (error) {
    if (error instanceof ProcessingError || error instanceof InvalidGlbError || error instanceof NetworkError) {
      throw error;
    }
    throw new ProcessingError(`Failed to transform Tripo3D GLB: ${error instanceof Error ? error.message : String(error)}`);
  }
}
