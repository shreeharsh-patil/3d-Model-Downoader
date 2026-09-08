import type { ModelMetadata } from '../../types';

export type TripoDetectionSource = 'api-response' | 'dom' | 'network' | 'performance';

export interface TripoAssetCandidate {
  url: string;
  modelKey: string;
  detectedAt: number;
  source: TripoDetectionSource;
  previewUrl?: string;
  metadata?: ModelMetadata;
  score: number;
}

const SOURCE_SCORE: Readonly<Record<TripoDetectionSource, number>> = {
  'api-response': 40,
  dom: 30,
  network: 20,
  performance: 10,
};

export function getTripoModelKey(url: string, baseUrl = 'https://tripo3d.ai/'): string | undefined {
  try {
    const parsed = new URL(url, baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

export class TripoModelStore {
  private readonly candidates = new Map<string, TripoAssetCandidate>();
  private activeCandidate: TripoAssetCandidate | null = null;
  private generationValue = 0;

  constructor(private readonly maxCandidates = 32) {}

  get active(): TripoAssetCandidate | null { return this.activeCandidate; }
  get generation(): number { return this.generationValue; }
  get size(): number { return this.candidates.size; }

  consider(input: Omit<TripoAssetCandidate, 'modelKey' | 'score'>, pageHint?: string): { activated: boolean; changed: boolean; candidate: TripoAssetCandidate } | null {
    const modelKey = getTripoModelKey(input.url);
    if (!modelKey) return null;
    const hint = pageHint?.toLowerCase();
    const correlated = Boolean(hint && hint.length >= 4 && modelKey.toLowerCase().includes(hint));
    const score = SOURCE_SCORE[input.source] + (correlated ? 100 : 0);
    const previous = this.candidates.get(modelKey);
    const candidate: TripoAssetCandidate = { ...previous, ...input, modelKey, score: Math.max(score, previous?.score ?? 0) };
    this.candidates.delete(modelKey);
    this.candidates.set(modelKey, candidate);
    while (this.candidates.size > this.maxCandidates) this.candidates.delete(this.candidates.keys().next().value!);

    if (this.activeCandidate?.modelKey === modelKey) {
      this.activeCandidate = candidate;
      return { activated: true, changed: false, candidate };
    }

    const shouldActivate = !this.activeCandidate ||
      correlated ||
      (input.source === 'api-response' && candidate.score > this.activeCandidate.score);
    if (!shouldActivate) return { activated: false, changed: false, candidate };

    this.activeCandidate = candidate;
    this.generationValue += 1;
    return { activated: true, changed: true, candidate };
  }

  updateMetadata(modelKey: string, generation: number, metadata: ModelMetadata): boolean {
    if (!this.activeCandidate || this.activeCandidate.modelKey !== modelKey || this.generationValue !== generation) return false;
    this.activeCandidate = { ...this.activeCandidate, metadata };
    this.candidates.set(modelKey, this.activeCandidate);
    return true;
  }

  clear(): void {
    this.activeCandidate = null;
    this.candidates.clear();
    this.generationValue += 1;
  }
}
