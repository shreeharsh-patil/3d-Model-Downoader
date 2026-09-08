import { WebIO } from '@gltf-transform/core';
import { strToU8, zipSync } from 'fflate';
import { logger } from './logger';

export interface ExtractedTextureZip {
  buffer: ArrayBuffer;
  filename: string;
  textureCount: number;
  extractedFiles: string[];
}

function getExtensionForMime(mime?: string, data?: Uint8Array): string {
  if (mime) {
    const lower = mime.toLowerCase();
    if (lower.includes('png')) return 'png';
    if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
    if (lower.includes('webp')) return 'webp';
    if (lower.includes('ktx2')) return 'ktx2';
  }

  if (data && data.length >= 4) {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'webp';
  }

  return 'png';
}

export async function extractPbrTextures(
  glbBuffer: ArrayBuffer,
  modelName: string = 'model',
): Promise<ExtractedTextureZip> {
  logger.info('TextureExtractor', `Extracting PBR textures from GLB (${glbBuffer.byteLength} bytes)...`);

  const io = new WebIO();
  const document = await io.readBinary(new Uint8Array(glbBuffer));
  const root = document.getRoot();
  const materials = root.listMaterials();
  const textures = root.listTextures();

  if (textures.length === 0) {
    throw new Error('This 3D model contains untextured vertex geometry and has no embedded PBR texture maps to extract.');
  }

  // Map each texture instance to its PBR semantic slot
  type SlotInfo = { materialName: string; slot: string };
  const textureSlots = new Map<unknown, SlotInfo>();

  for (const mat of materials) {
    const matName = mat.getName() || 'material';
    const base = mat.getBaseColorTexture();
    const normal = mat.getNormalTexture();
    const metallicRoughness = mat.getMetallicRoughnessTexture();
    const occlusion = mat.getOcclusionTexture();
    const emissive = mat.getEmissiveTexture();

    if (base && !textureSlots.has(base)) textureSlots.set(base, { materialName: matName, slot: 'albedo_baseColor' });
    if (normal && !textureSlots.has(normal)) textureSlots.set(normal, { materialName: matName, slot: 'normal' });
    if (metallicRoughness && !textureSlots.has(metallicRoughness)) {
      textureSlots.set(metallicRoughness, { materialName: matName, slot: 'metallic_roughness' });
    }
    if (occlusion && !textureSlots.has(occlusion)) textureSlots.set(occlusion, { materialName: matName, slot: 'ambient_occlusion' });
    if (emissive && !textureSlots.has(emissive)) textureSlots.set(emissive, { materialName: matName, slot: 'emissive' });
  }

  const cleanBaseName = modelName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const zipFiles: Record<string, Uint8Array> = {};
  const extractedFiles: string[] = [];
  const usedFileNames = new Set<string>();

  for (let i = 0; i < textures.length; i++) {
    const tex = textures[i];
    const imageBytes = tex.getImage();
    if (!imageBytes || imageBytes.byteLength === 0) continue;

    const ext = getExtensionForMime(tex.getMimeType(), imageBytes);
    const slotInfo = textureSlots.get(tex);

    let filename: string;
    if (slotInfo) {
      const matPrefix = materials.length > 1 ? `${slotInfo.materialName}_` : '';
      filename = `${cleanBaseName}_${matPrefix}${slotInfo.slot}.${ext}`;
    } else {
      const customName = tex.getName();
      filename = customName
        ? `${cleanBaseName}_${customName}.${ext}`
        : `${cleanBaseName}_texture_${String(i + 1).padStart(2, '0')}.${ext}`;
    }

    // Ensure unique filename
    let uniqueName = filename;
    let counter = 1;
    while (usedFileNames.has(uniqueName)) {
      uniqueName = filename.replace(new RegExp(`\\.${ext}$`), `_${counter}.${ext}`);
      counter++;
    }
    usedFileNames.add(uniqueName);

    zipFiles[uniqueName] = imageBytes;
    extractedFiles.push(uniqueName);
  }

  if (extractedFiles.length === 0) {
    throw new Error('No valid image data could be extracted from embedded textures.');
  }

  // Add documentation readme in the ZIP
  const readmeContent = [
    `PBR Texture Pack for "${modelName}"`,
    '='.repeat(40),
    `Extracted on: ${new Date().toISOString()}`,
    `Total Textures: ${extractedFiles.length}`,
    '',
    'Files Included:',
    ...extractedFiles.map((f) => `  - ${f}`),
    '',
    'glTF 2.0 PBR Material Channel Guide:',
    '  * albedo_baseColor: Base color / diffuse reflectance map.',
    '  * normal: Tangent-space normal map for surface relief.',
    '  * metallic_roughness: Standard packed ORM map (Red = Occlusion, Green = Roughness, Blue = Metallic).',
    '  * ambient_occlusion: Surface ambient occlusion shadowing.',
    '  * emissive: Self-illumination color and intensity map.',
    '',
    'Exported via PolyFetch 3D browser extension.',
  ].join('\n');

  zipFiles['README.txt'] = strToU8(readmeContent);

  const zipped = zipSync(zipFiles, { level: 6 });
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);

  const zipFilename = `${cleanBaseName}_pbr_textures.zip`;
  logger.info('TextureExtractor', `Packed ${extractedFiles.length} textures into ${zipFilename} (${copy.byteLength} bytes)`);

  return {
    buffer: copy.buffer,
    filename: zipFilename,
    textureCount: extractedFiles.length,
    extractedFiles,
  };
}
