import type { WebsiteId } from './types';

const FORBIDDEN_FS_CHARS = /[\\/:*?"<>|\x00-\x1F]/g;
const MAX_BASE_FILENAME_LENGTH = 80;

export function formatTimestamp(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

export function sanitizeFilename(rawName: string | undefined, provider: WebsiteId = 'meshy', extension = 'glb'): string {
  let ext = extension.startsWith('.') ? extension.slice(1) : extension;
  if (ext === 'textures') ext = 'zip';
  const fallback = `${provider}-model-${formatTimestamp()}.${ext}`;

  if (!rawName || typeof rawName !== 'string') {
    return fallback;
  }

  // Strip extension if present in rawName
  let clean = rawName.trim();
  clean = clean.replace(/\.(glb|gltf|bin|zip|stl|obj|usdz)$/i, '');

  // Replace invalid filesystem characters with an underscore
  clean = clean.replace(FORBIDDEN_FS_CHARS, '_');

  // Replace multiple underscores/spaces with single
  clean = clean.replace(/\s+/g, '-').replace(/_+/g, '_').trim();

  // Strip leading/trailing dots, hyphens, underscores
  clean = clean.replace(/^[-_.]+|[-_.]+$/g, '');

  if (!clean) {
    return fallback;
  }

  // Truncate if excessively long
  if (clean.length > MAX_BASE_FILENAME_LENGTH) {
    clean = clean.slice(0, MAX_BASE_FILENAME_LENGTH).replace(/[-_.]+$/g, '');
  }

  // Ensure provider tag is included if not already present
  const suffix = `_${provider}`;
  if (!clean.toLowerCase().includes(provider)) {
    clean = `${clean}${suffix}`;
  }

  return `${clean}.${ext}`;
}
