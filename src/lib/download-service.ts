import { InvalidGlbError } from './errors';
import { sanitizeFilename } from './filename';
import { validateGlb } from './glb-validator';
import { logger } from './logger';
import { convertModel } from './model-converter';
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

  // Attempt download via DOM anchor tag: fast, reliable, zero base64 transcoding overhead,
  // and handles models of any size (including large animated models) without browser IPC limits.
  let downloaded = false;
  if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([targetBuffer], { type: targetMimeType });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = finalFilename;
      a.setAttribute('data-polyfetch', 'true');
      if (a.dataset) {
        a.dataset.polyfetch = 'true';
      }
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      downloaded = true;
      logger.info('DownloadService', `Started download for ${finalFilename} via DOM anchor (${targetBuffer.byteLength} bytes)`);
    } catch (domErr) {
      logger.debug('DownloadService', 'DOM anchor download failed, attempting browser.downloads fallback', domErr);
    } finally {
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 10000);
    }
  }

  // Fallback to background browser.downloads API if DOM was unavailable or failed
  if (!downloaded) {
    try {
      const { browser } = await import('#imports');
      // Only attempt base64 IPC if buffer is within safe message size limit (< 20MB)
      if (targetBuffer.byteLength <= 20 * 1024 * 1024) {
        const { encodeModelBuffer } = await import('./binary-message');
        const bufferBase64 = encodeModelBuffer(targetBuffer);
        const downloadRes = (await browser.runtime.sendMessage({
          type: 'trigger-download',
          bufferBase64,
          filename: finalFilename,
          mimeType: targetMimeType,
        })) as { ok: boolean; error?: string } | undefined;

        if (downloadRes?.ok) {
          downloaded = true;
          logger.info('DownloadService', `Started download for ${finalFilename} via browser.downloads (${targetBuffer.byteLength} bytes)`);
        } else {
          logger.debug('DownloadService', `browser.downloads fallback unavailable or rejected: ${downloadRes?.error ?? 'unknown'}`);
        }
      } else {
        logger.warn('DownloadService', `Model too large for background IPC fallback (${targetBuffer.byteLength} bytes)`);
      }
    } catch (err) {
      logger.debug('DownloadService', 'Background download fallback failed', err);
    }
  }

  // Record in history
  try {
    const { browser } = await import('#imports');
    await browser.runtime.sendMessage({
      type: 'record-download',
      item: {
        modelName: modelName || finalFilename.replace(/\.[^.]+$/i, ''),
        provider,
        format: exportFormat,
        filename: finalFilename,
        size: targetBuffer.byteLength,
      },
    });
  } catch (err) {
    logger.warn('DownloadService', 'Failed to add download to history', err);
  }

  return {
    success: true,
    filename: finalFilename,
    size: targetBuffer.byteLength,
    format: exportFormat,
  };
}
