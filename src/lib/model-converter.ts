import type { ExportFormat } from './types';
import { logger } from './logger';

export interface ConvertedModel {
  buffer: ArrayBuffer;
  extension: string;
  mimeType: string;
  byteLength: number;
}

export const FORMAT_MIME_TYPES: Record<ExportFormat, string> = {
  glb: 'model/gltf-binary',
  stl: 'model/stl',
  obj: 'model/obj',
  usdz: 'model/vnd.usdz+zip',
  textures: 'application/zip',
};

export const FORMAT_LABELS: Record<ExportFormat, { label: string; description: string }> = {
  glb: {
    label: 'GLB',
    description: 'Universal glTF 2.0 binary container with full materials, textures, and animations.',
  },
  stl: {
    label: 'STL',
    description: 'Binary stereolithography mesh optimized for 3D printing slicing (Cura, Prusa, Bambu).',
  },
  obj: {
    label: 'OBJ',
    description: 'Wavefront OBJ geometry with vertex positions, normals, and UV coordinates.',
  },
  usdz: {
    label: 'USDZ',
    description: 'Universal Scene Description package for Apple AR Quick Look and iOS preview.',
  },
  textures: {
    label: 'ZIP',
    description: 'PBR Texture pack (.zip) extracting Albedo, Normal, Roughness, and Metallic maps.',
  },
};

function toArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

export async function convertModel(
  glbBuffer: ArrayBuffer,
  targetFormat: ExportFormat = 'glb',
  modelName: string = 'model',
): Promise<ConvertedModel> {
  if (targetFormat === 'glb') {
    return {
      buffer: glbBuffer,
      extension: 'glb',
      mimeType: FORMAT_MIME_TYPES.glb,
      byteLength: glbBuffer.byteLength,
    };
  }

  if (targetFormat === 'textures') {
    const { extractPbrTextures } = await import('./texture-extractor');
    const zipResult = await extractPbrTextures(glbBuffer, modelName);
    return {
      buffer: zipResult.buffer,
      extension: 'zip',
      mimeType: FORMAT_MIME_TYPES.textures,
      byteLength: zipResult.buffer.byteLength,
    };
  }

  logger.info('ModelConverter', `Converting GLB to ${targetFormat.toUpperCase()} (${glbBuffer.byteLength} bytes)...`);

  // Ensure globalThis.self is defined for Three.js loaders in various JS environments
  if (typeof globalThis.self === 'undefined') {
    (globalThis as unknown as { self: typeof globalThis }).self = globalThis;
  }

  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();

    const gltf = await loader.parseAsync(
      glbBuffer.slice(0),
      '',
    );

    const scene = gltf.scene || gltf.scenes?.[0];
    if (!scene) {
      throw new Error('Failed to parse 3D scene from GLB container.');
    }

    // Ensure all meshes have computed vertex normals for clean STL / OBJ / USDZ export
    scene.traverse((child: unknown) => {
      const obj = child as { isMesh?: boolean; geometry?: { attributes: Record<string, unknown>; computeVertexNormals: () => void } };
      if (obj.isMesh && obj.geometry) {
        if (!obj.geometry.attributes.normal) {
          obj.geometry.computeVertexNormals();
        }
      }
    });

    if (targetFormat === 'stl') {
      const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
      const exporter = new STLExporter();
      const stlResult = exporter.parse(scene, { binary: true }) as DataView;
      const buffer = toArrayBuffer(stlResult);

      logger.info('ModelConverter', `Successfully converted to binary STL (${buffer.byteLength} bytes)`);
      return {
        buffer,
        extension: 'stl',
        mimeType: FORMAT_MIME_TYPES.stl,
        byteLength: buffer.byteLength,
      };
    }

    if (targetFormat === 'obj') {
      const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
      const exporter = new OBJExporter();
      const objString = exporter.parse(scene);
      const encoded = new TextEncoder().encode(objString);
      const buffer = toArrayBuffer(encoded);

      logger.info('ModelConverter', `Successfully converted to Wavefront OBJ (${buffer.byteLength} bytes)`);
      return {
        buffer,
        extension: 'obj',
        mimeType: FORMAT_MIME_TYPES.obj,
        byteLength: buffer.byteLength,
      };
    }

    if (targetFormat === 'usdz') {
      const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
      const exporter = new USDZExporter();
      const usdzBytes = (await exporter.parseAsync(scene, {
        quickLookCompatible: true,
        maxTextureSize: 2048,
      })) as Uint8Array;

      const buffer = toArrayBuffer(usdzBytes);

      logger.info('ModelConverter', `Successfully converted to USDZ package (${buffer.byteLength} bytes)`);
      return {
        buffer,
        extension: 'usdz',
        mimeType: FORMAT_MIME_TYPES.usdz,
        byteLength: buffer.byteLength,
      };
    }
  } catch (error) {
    logger.error('ModelConverter', `Failed to convert model to ${targetFormat}`, error);
    throw new Error(
      `Failed to convert 3D model to ${targetFormat.toUpperCase()}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  throw new Error(`Unsupported export format: ${targetFormat}`);
}
