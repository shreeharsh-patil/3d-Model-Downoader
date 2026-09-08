import { beforeEach, describe, expect, it } from 'vitest';
import { tabStateManager } from '../src/lib/tab-state';
import type { DetectedModel } from '../src/lib/types';

describe('Tab State Isolation & Stale Protection', () => {
  beforeEach(() => {
    tabStateManager.clear();
  });

  it('isolates state per tab', () => {
    const tab1 = tabStateManager.getOrCreate(1, 'https://www.meshy.ai/workspace/text-to-3d/modelA');
    const tab2 = tabStateManager.getOrCreate(2, 'https://www.meshy.ai/workspace/text-to-3d/modelB');

    const modelA: DetectedModel = {
      id: 'modelA',
      provider: 'meshy',
      name: 'Model A',
      pageUrl: 'https://www.meshy.ai/workspace/text-to-3d/modelA',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };

    const modelB: DetectedModel = {
      id: 'modelB',
      provider: 'meshy',
      name: 'Model B',
      pageUrl: 'https://www.meshy.ai/workspace/text-to-3d/modelB',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };

    tabStateManager.updateModel(1, modelA, tab1.revision);
    tabStateManager.updateModel(2, modelB, tab2.revision);

    expect(tabStateManager.get(1)?.model?.id).toBe('modelA');
    expect(tabStateManager.get(2)?.model?.id).toBe('modelB');
  });

  it('prevents stale async result from overwriting newer model state (A -> B -> C)', () => {
    const tabId = 10;
    const initial = tabStateManager.getOrCreate(tabId, 'https://www.meshy.ai/workspace/text-to-3d/modelA');
    const revA = initial.revision;

    // Fast switch A -> B -> C
    tabStateManager.onUrlChange(tabId, 'https://www.meshy.ai/workspace/text-to-3d/modelB');
    const stateC = tabStateManager.onUrlChange(tabId, 'https://www.meshy.ai/workspace/text-to-3d/modelC');
    const revC = stateC.revision;

    expect(revC).toBeGreaterThan(revA);

    const modelC: DetectedModel = {
      id: 'modelC',
      provider: 'meshy',
      name: 'Model C',
      pageUrl: 'https://www.meshy.ai/workspace/text-to-3d/modelC',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };
    tabStateManager.updateModel(tabId, modelC, revC);

    // Stale async callback for Model A arrives later
    const modelA: DetectedModel = {
      id: 'modelA',
      provider: 'meshy',
      name: 'Model A',
      pageUrl: 'https://www.meshy.ai/workspace/text-to-3d/modelA',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };
    const updateResult = tabStateManager.updateModel(tabId, modelA, revA);

    expect(updateResult).toBeNull();
    expect(tabStateManager.get(tabId)?.model?.id).toBe('modelC');
    expect(tabStateManager.get(tabId)?.model?.name).toBe('Model C');
  });

  it('cleans up tab state when tab closes', () => {
    tabStateManager.getOrCreate(5, 'https://www.meshy.ai/workspace');
    expect(tabStateManager.get(5)).toBeDefined();

    tabStateManager.remove(5);
    expect(tabStateManager.get(5)).toBeUndefined();
  });

  it('resets model state when tab navigates to a new page', () => {
    const tab = tabStateManager.getOrCreate(7, 'https://www.meshy.ai/workspace/text-to-3d/model1');
    const model1: DetectedModel = {
      id: 'model1',
      provider: 'meshy',
      name: 'Model 1',
      pageUrl: 'https://www.meshy.ai/workspace/text-to-3d/model1',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };
    tabStateManager.updateModel(7, model1, tab.revision);
    expect(tabStateManager.get(7)?.model).toBeDefined();

    tabStateManager.onUrlChange(7, 'https://www.meshy.ai/workspace/text-to-3d/model2');
    expect(tabStateManager.get(7)?.model).toBeUndefined();
    expect(tabStateManager.get(7)?.revision).toBe(tab.revision + 1);
  });

  it('can clear a detected model without leaving stale popup state', () => {
    const state = tabStateManager.getOrCreate(8, 'https://meshy.ai/workspace');
    const model: DetectedModel = {
      id: 'model1',
      provider: 'meshy',
      pageUrl: 'https://meshy.ai/workspace',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };
    tabStateManager.updateModel(8, model, state.revision);

    const cleared = tabStateManager.clearModel(8, state.revision, 'detecting');

    expect(cleared?.model).toBeUndefined();
    expect(cleared?.modelId).toBeUndefined();
    expect(cleared?.status).toBe('detecting');
  });
});
