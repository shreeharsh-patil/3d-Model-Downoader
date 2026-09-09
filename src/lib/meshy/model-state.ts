import { LruModelCache, type LruCacheLimits } from '../lru-model-cache';
import type { CapturedModelAsset, ModelCandidate } from '../types';

/** Removes query/fragment secrets while retaining the stable asset directory. */
export function getModelKey(url: string | undefined, baseUrl = 'https://www.meshy.ai/'): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, baseUrl);
    const directory = parsed.pathname.replace(/\/[^/]+$/, '');
    return directory && directory !== '/' ? `${parsed.origin}${directory}` : undefined;
  } catch {
    return undefined;
  }
}

type CachedAsset = Omit<CapturedModelAsset, 'generation' | 'bufferStatus'>;

export class MeshyModelStore {
  private currentGlb: CapturedModelAsset | null = null;
  private activeCandidate: ModelCandidate | null = null;
  private readonly glbCache: LruModelCache<CachedAsset>;
  private readonly textureUrls = new Map<string, Set<string>>();
  private generation = 0;

  constructor(cacheLimits?: LruCacheLimits) {
    this.glbCache = new LruModelCache(cacheLimits);
  }

  get current(): CapturedModelAsset | null {
    if (!this.activeCandidate) {
      return null;
    }
    if (this.isCurrentAsset(this.currentGlb)) {
      return this.currentGlb;
    }
    const cached = this.glbCache.get(this.activeCandidate.modelKey) ?? this.glbCache.latest;
    if (cached) {
      this.currentGlb = {
        ...cached,
        modelKey: this.activeCandidate.modelKey,
        generation: this.activeCandidate.generation,
        bufferStatus: 'ready',
      };
      return this.currentGlb;
    }
    return null;
  }

  get candidate(): ModelCandidate | null {
    return this.activeCandidate;
  }

  get currentModelKey(): string | undefined {
    return this.activeCandidate?.modelKey;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  get cacheSize(): number {
    return this.glbCache.size;
  }

  get cacheByteLength(): number {
    return this.glbCache.byteLength;
  }

  activateCandidate(input: Omit<ModelCandidate, 'generation'>): { isNew: boolean; candidate: ModelCandidate } {
    const isNew = input.modelKey !== this.activeCandidate?.modelKey;
    if (isNew) {
      this.generation += 1;
      this.currentGlb = null;
    }
    const candidate: ModelCandidate = {
      ...input,
      generation: this.generation,
      jsonUrl: input.jsonUrl ?? (isNew ? undefined : this.activeCandidate?.jsonUrl),
      binaryUrl: input.binaryUrl ?? (isNew ? undefined : this.activeCandidate?.binaryUrl),
    };
    this.activeCandidate = candidate;

    const cached = this.glbCache.get(candidate.modelKey) ?? this.glbCache.latest;
    if (cached) {
      this.currentGlb = {
        ...cached,
        modelKey: candidate.modelKey,
        generation: candidate.generation,
        bufferStatus: 'ready',
      };
    }
    return { isNew, candidate };
  }

  noteBinary(modelKey: string, binaryUrl: string, detectedAt = Date.now()): ModelCandidate {
    if (!this.activeCandidate || this.activeCandidate.modelKey !== modelKey) {
      return this.activateCandidate({ provider: 'meshy', modelKey, binaryUrl, detectedAt }).candidate;
    }
    this.activeCandidate = { ...this.activeCandidate, binaryUrl, detectedAt };
    return this.activeCandidate;
  }

  /** Cache any correlated result, and activate it for immediate download. */
  acceptDecodedGlb(buffer: ArrayBuffer, modelKey: string, sourceUrl?: string, capturedAt = Date.now(), metadata?: CapturedModelAsset['metadata']): CapturedModelAsset {
    const cached: CachedAsset = {
      provider: 'meshy',
      modelKey,
      capturedAt,
      sourceUrl,
      buffer,
      byteLength: buffer.byteLength,
      metadata,
    };
    this.glbCache.set(modelKey, cached);
    if (this.activeCandidate && this.activeCandidate.modelKey !== modelKey) {
      this.glbCache.set(this.activeCandidate.modelKey, cached);
    }

    if (!this.activeCandidate) {
      this.activeCandidate = {
        provider: 'meshy',
        modelKey,
        binaryUrl: sourceUrl,
        detectedAt: capturedAt,
        generation: this.generation,
      };
    }

    this.currentGlb = {
      ...cached,
      modelKey: this.activeCandidate.modelKey,
      generation: this.activeCandidate.generation,
      bufferStatus: 'ready',
    };
    return this.currentGlb;
  }

  isCurrentAsset(asset: CapturedModelAsset | null): asset is CapturedModelAsset {
    if (!asset || asset.bufferStatus !== 'ready') return false;
    if (!this.activeCandidate) return true;
    return (
      (asset.modelKey === this.activeCandidate.modelKey || this.glbCache.latest?.buffer === asset.buffer) &&
      asset.generation === this.activeCandidate.generation
    );
  }

  addTextureUrl(modelKey: string, url: string): void {
    const list = this.textureUrls.get(modelKey) ?? new Set<string>();
    list.add(url);
    this.textureUrls.set(modelKey, list);
  }

  getTextureUrls(modelKey: string): string[] {
    return [...(this.textureUrls.get(modelKey) ?? [])];
  }

  getTextureUrl(modelKey?: string): string | undefined {
    if (!modelKey) return undefined;
    const urls = this.getTextureUrls(modelKey);
    return urls.length > 0 ? urls[0] : undefined;
  }

  resetCurrentModel(): void {
    this.generation += 1;
    this.currentGlb = null;
    this.activeCandidate = null;
  }

  dispose(): void {
    this.resetCurrentModel();
    this.glbCache.clear();
    this.textureUrls.clear();
  }
}

export const meshyModelStore = new MeshyModelStore();
