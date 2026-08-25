import { logger } from './logger';
import { findProvider } from './providers/registry';
import type { DetectedModel, ModelStatus, TabModelState } from './types';

class TabStateManager {
  private tabStates = new Map<number, TabModelState>();

  get(tabId: number): TabModelState | undefined {
    return this.tabStates.get(tabId);
  }

  getOrCreate(tabId: number, url?: string): TabModelState {
    const existing = this.tabStates.get(tabId);
    if (existing) {
      if (url && existing.pageUrl !== url) {
        return this.onUrlChange(tabId, url);
      }
      return existing;
    }

    const provider = findProvider(url);
    const initial: TabModelState = {
      tabId,
      provider: provider?.id,
      pageUrl: url,
      revision: 1,
      updatedAt: Date.now(),
      status: provider ? 'detecting' : 'ready',
    };
    this.tabStates.set(tabId, initial);
    return initial;
  }

  bumpRevision(tabId: number): number {
    const state = this.tabStates.get(tabId);
    if (!state) return 1;
    state.revision += 1;
    state.updatedAt = Date.now();
    return state.revision;
  }

  updateModel(tabId: number, model: DetectedModel, revision: number): TabModelState | null {
    const current = this.tabStates.get(tabId);
    if (!current) {
      logger.debug('TabState', `Tab ${tabId} not found for model update`);
      return null;
    }

    // Stale async protection: reject updates from older revisions
    if (revision < current.revision) {
      logger.debug(
        'TabState',
        `Ignored stale model update for tab ${tabId}: update rev ${revision} < current rev ${current.revision}`,
      );
      return null;
    }

    current.model = model;
    current.modelId = model.id;
    current.status = model.status;
    current.error = model.error;
    current.updatedAt = Date.now();
    return current;
  }

  setStatus(tabId: number, status: ModelStatus, error?: string): void {
    const current = this.tabStates.get(tabId);
    if (current) {
      current.status = status;
      current.error = error;
      current.updatedAt = Date.now();
    }
  }

  onUrlChange(tabId: number, newUrl: string): TabModelState {
    const current = this.tabStates.get(tabId);
    const provider = findProvider(newUrl);

    // If switching models or navigating, bump revision to invalidate pending requests
    const newRevision = (current?.revision ?? 0) + 1;
    const newState: TabModelState = {
      tabId,
      provider: provider?.id,
      pageUrl: newUrl,
      modelId: undefined,
      model: undefined,
      revision: newRevision,
      updatedAt: Date.now(),
      status: provider ? 'detecting' : 'ready',
    };

    this.tabStates.set(tabId, newState);
    logger.debug('TabState', `Tab ${tabId} navigated to ${newUrl}, rev=${newRevision}`);
    return newState;
  }

  remove(tabId: number): void {
    this.tabStates.delete(tabId);
    logger.debug('TabState', `Cleaned state for closed tab ${tabId}`);
  }

  clear(): void {
    this.tabStates.clear();
  }
}

export const tabStateManager = new TabStateManager();
