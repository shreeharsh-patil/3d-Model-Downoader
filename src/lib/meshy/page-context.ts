import { meshyModelStore } from './model-state';
import { meshyProvider } from '../providers/meshy/meshy-provider';

export function extractMeshyModelName(): string | undefined {
  try {
    // Check for explicit title or prompt inputs in Meshy workspace
    const titleInput = document.querySelector(
      'input[placeholder*="Name"], input[aria-label*="Name"]',
    ) as HTMLInputElement | null;
    if (titleInput?.value && titleInput.value.trim().length > 0) {
      return titleInput.value.trim();
    }

    // Check header or active model heading
    const heading = document.querySelector('main h1, main h2, [data-testid="model-title"]');
    if (heading?.textContent && heading.textContent.trim().length > 0) {
      const text = heading.textContent.trim();
      if (text !== 'Workspace' && text !== 'Text to 3D' && text !== 'Image to 3D' && text.length < 60) {
        return text;
      }
    }

    // Fall back to taskId from URL
    const taskId = meshyProvider.extractModelId(window.location.href);
    if (taskId) {
      return `meshy-${taskId}`;
    }
  } catch {
    // ignore
  }

  return undefined;
}

export function extractMeshyThumbnailUrl(): string | undefined {
  try {
    // 1. Look for rendered model preview or thumbnail images in the DOM
    const imgSelectors = [
      'img[src*="thumbnail"]',
      'img[src*="preview"]',
      'img[src*="render"]',
      'img[src*="cover"]',
      'img[src*="/tasks/"]',
      '[data-testid="model-preview"] img',
      '.model-card.active img',
      'main img[src*="meshy"]',
    ];

    for (const selector of imgSelectors) {
      const img = document.querySelector(selector) as HTMLImageElement | null;
      if (img?.src && img.src.startsWith('http') && !img.src.includes('avatar') && !img.src.includes('logo')) {
        return img.src;
      }
    }

    // 2. Check OpenGraph image meta tag
    const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (ogImage && ogImage.startsWith('http') && !ogImage.includes('default-og')) {
      return ogImage;
    }

    // 3. Fallback to captured texture URL
    const modelKey = meshyModelStore.currentModelKey;
    const texture = modelKey ? meshyModelStore.getTextureUrls(modelKey)[0] : undefined;
    if (texture) {
      return texture;
    }

    // 4. Fallback to 3D canvas snapshot
    const canvas = document.querySelector('main canvas, [data-testid*="viewer"] canvas, canvas') as HTMLCanvasElement | null;
    if (canvas && canvas.width >= 64 && canvas.height >= 64) {
      try {
        const dataUrl = canvas.toDataURL('image/webp', 0.8);
        if (dataUrl && dataUrl.length > 500) {
          return dataUrl;
        }
      } catch {
        // canvas might be tainted or context not preserved
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}
