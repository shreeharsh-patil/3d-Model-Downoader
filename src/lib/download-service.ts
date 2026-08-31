import { InvalidGlbError } from './errors';
import { sanitizeFilename } from './filename';
import { validateGlb } from './glb-validator';
import { logger } from './logger';
import { convertModel } from './model-converter';
import { addDownloadToHistory } from './storage';
import type { ExportFormat, WebsiteId } from './types';

export interface DownloadOptions {
  filename?: string;
  modelName?: string;
  provider: WebsiteId;
  exportFormat?: ExportFormat;
  mimeType?: string;
  skipValidation?: boolean;
}

export async function executeDownload(
  buffer: ArrayBuffer,
  options: DownloadOptions,
): Promise<{ success: boolean; filename: string; size: number; format: ExportFormat }> {
  const { provider, modelName, exportFormat = 'glb', skipValidation = false } = options;

  if (!skipValidation) {
    const validation = validateGlb(buffer);
    if (!validation.valid) {
      logger.error('DownloadService', 'GLB validation failed:', validation.reason);
      throw new InvalidGlbError(validation.reason ?? 'Unknown validation failure');
    }
  }

  // Convert to requested format (GLB, STL, OBJ, USDZ, Textures ZIP)
  const converted = await convertModel(buffer, exportFormat, modelName || options.filename);
  const targetBuffer = converted.buffer;
  const targetExtension = converted.extension;
  const targetMimeType = options.mimeType || converted.mimeType;

  const finalFilename = sanitizeFilename(options.filename || modelName, provider, targetExtension);
  const blob = new Blob([targetBuffer], { type: targetMimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = finalFilename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();

    logger.info('DownloadService', `Started download for ${finalFilename} (${targetBuffer.byteLength} bytes)`);

    // Record in history
    await addDownloadToHistory({
      modelName: modelName || finalFilename.replace(/\.[^.]+$/i, ''),
      provider,
      format: exportFormat,
      filename: finalFilename,
      size: targetBuffer.byteLength,
    }).catch((err) => {
      logger.warn('DownloadService', 'Failed to add download to history', err);
    });

    return {
      success: true,
      filename: finalFilename,
      size: targetBuffer.byteLength,
      format: exportFormat,
    };
  } finally {
    // Release object URL after small timeout to ensure browser initiates download
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 5000);
  }
}
