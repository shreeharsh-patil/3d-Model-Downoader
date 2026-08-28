export function getModelKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.href);
    const dir = parsed.pathname.replace(/\/[^/]+$/, '');
    return `${parsed.origin}${dir}`;
  } catch {
    const noQuery = url.split('?')[0];
    return noQuery.replace(/\/[^/]+$/, '');
  }
}

export interface CachedGlb {
  buffer: ArrayBuffer;
  byteLength: number;
  modelKey: string;
  sourceUrl?: string;
  generation: number;
}

export class MeshyModelStore {
  private currentGlb: CachedGlb | null = null;
  private currentJsonModelKey: string | undefined;
  private glbCache = new Map<string, { buffer: ArrayBuffer; byteLength: number }>();
  private textureUrls = new Map<string, string[]>();
  private lastTextureUrl: string | undefined;
  private generation = 0;

  get current(): CachedGlb | null {
    return this.currentGlb;
  }

  get currentModelKey(): string | undefined {
    return this.currentJsonModelKey;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  resetCurrentModel(): void {
    this.currentGlb = null;
    this.currentJsonModelKey = undefined;
    this.bumpGeneration();
  }

  setJsonModelKey(key?: string): { isNew: boolean; generation: number } {
    const isNew = key !== undefined && key !== this.currentJsonModelKey;
    if (isNew) {
      this.bumpGeneration();
      this.currentJsonModelKey = key;
    }
    return { isNew, generation: this.generation };
  }

  getCachedGlb(modelKey: string): { buffer: ArrayBuffer; byteLength: number } | undefined {
    return this.glbCache.get(modelKey);
  }

  setCurrentGlb(buffer: ArrayBuffer, modelKey: string, sourceUrl?: string): CachedGlb {
    const cachedGlb: CachedGlb = {
      buffer,
      byteLength: buffer.byteLength,
      modelKey,
      sourceUrl,
      generation: this.generation,
    };
    this.currentGlb = cachedGlb;
    this.glbCache.set(modelKey, { buffer: buffer.slice(0), byteLength: buffer.byteLength });
    return cachedGlb;
  }

  addTextureUrl(url: string): void {
    this.lastTextureUrl = url;
    const modelKey = getModelKey(url);
    if (modelKey) {
      const list = this.textureUrls.get(modelKey) ?? [];
      if (!list.includes(url)) {
        list.push(url);
        this.textureUrls.set(modelKey, list);
      }
    }
  }

  getTextureUrl(modelKey?: string): string | undefined {
    if (modelKey) {
      const list = this.textureUrls.get(modelKey);
      if (list && list.length > 0) return list[0];
    }
    return this.lastTextureUrl;
  }
}

export const meshyModelStore = new MeshyModelStore();
