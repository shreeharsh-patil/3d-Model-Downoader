import { describe, expect, it } from 'vitest';
import { getModelKey, MeshyModelStore } from '../src/lib/meshy/model-state';
import { getMeshyPageModelHint, isMeshyModelKeyCorrelatedWithPage } from '../src/lib/meshy/model-correlation';

function makeGlb(size = 24): ArrayBuffer {
  const bytes = new Uint8Array(size);
  bytes.set([103, 108, 84, 70, 2]); // 'glTF'
  return bytes.buffer;
}

describe('MeshyModelStore', () => {
  it('normalizes asset directory URLs for model keys', () => {
    expect(getModelKey('https://assets.meshy.ai/tasks/abc-123/model.meshy?token=xyz')).toBe(
      'https://assets.meshy.ai/tasks/abc-123',
    );
    expect(getModelKey('invalid-url')).toBeUndefined();
    expect(getModelKey(undefined)).toBeUndefined();
  });

  it('immediately activates decoded GLB even when no prior candidate was registered', () => {
    const store = new MeshyModelStore();
    const buffer = makeGlb();
    const activated = store.acceptDecodedGlb(buffer, 'https://www.meshy.ai/workspace/text-to-3d');

    expect(activated).not.toBeNull();
    expect(activated.buffer).toBe(buffer);
    expect(store.current).not.toBeNull();
    expect(store.current?.buffer).toBe(buffer);
    expect(store.candidate).not.toBeNull();
  });

  it('activates and caches GLB even when candidate modelKey differs slightly from decoded asset key', () => {
    const store = new MeshyModelStore();
    store.activateCandidate({
      provider: 'meshy',
      modelKey: 'https://assets.meshy.ai/tasks/task-456',
      jsonUrl: 'https://assets.meshy.ai/tasks/task-456/model.json',
      detectedAt: 1,
    });

    const buffer = makeGlb();
    const activated = store.acceptDecodedGlb(buffer, 'https://www.meshy.ai/workspace/text-to-3d/task-456');

    expect(activated).not.toBeNull();
    expect(store.current).not.toBeNull();
    expect(store.current?.buffer).toBe(buffer);
    expect(store.current?.modelKey).toBe('https://assets.meshy.ai/tasks/task-456');
  });

  it('falls back to latest cached GLB when activating candidate', () => {
    const store = new MeshyModelStore();
    const buffer = makeGlb();
    store.acceptDecodedGlb(buffer, 'https://assets.meshy.ai/tasks/task-789');

    store.activateCandidate({
      provider: 'meshy',
      modelKey: 'https://assets.meshy.ai/tasks/task-789',
      binaryUrl: 'https://assets.meshy.ai/tasks/task-789/model.meshy',
      detectedAt: 1,
    });

    expect(store.current).not.toBeNull();
    expect(store.current?.buffer).toBe(buffer);
    expect(store.current?.modelKey).toBe('https://assets.meshy.ai/tasks/task-789');
  });

  it('resets state on route change', () => {
    const store = new MeshyModelStore();
    const buffer = makeGlb();
    store.acceptDecodedGlb(buffer, 'https://assets.meshy.ai/tasks/task-100');
    expect(store.current).not.toBeNull();

    store.resetCurrentModel();
    expect(store.current).toBeNull();
  });
});

describe('Meshy Model Route Correlation', () => {
  it('does not treat generic route segments as model IDs', () => {
    expect(getMeshyPageModelHint('https://www.meshy.ai/workspace/text-to-3d/generate')).toBeUndefined();
    expect(getMeshyPageModelHint('https://www.meshy.ai/workspace/text-to-3d/history')).toBeUndefined();
    expect(getMeshyPageModelHint('https://www.meshy.ai/workspace/text-to-3d/create')).toBeUndefined();
    expect(getMeshyPageModelHint('https://www.meshy.ai/workspace/text-to-3d')).toBeUndefined();
  });

  it('extracts valid model/task IDs from URL route or query', () => {
    expect(getMeshyPageModelHint('https://www.meshy.ai/workspace/text-to-3d/0192d4ee-58f0-7b6c-a81d-8426cbfeea41')).toBe(
      '0192d4ee-58f0-7b6c-a81d-8426cbfeea41',
    );
    expect(getMeshyPageModelHint('https://www.meshy.ai/workspace/text-to-3d?taskId=0192d4ee-58f0-7b6c-a81d-8426cbfeea41')).toBe(
      '0192d4ee-58f0-7b6c-a81d-8426cbfeea41',
    );
  });

  it('allows model download on generic routes where hint is undefined', () => {
    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/abc-123',
      'https://www.meshy.ai/workspace/text-to-3d/generate',
    )).toBe(true);

    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/abc-123',
      'https://www.meshy.ai/workspace/text-to-3d',
    )).toBe(true);
  });

  it('correlates model key when route has specific task ID', () => {
    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/0192d4ee-58f0-7b6c-a81d-8426cbfeea41',
      'https://www.meshy.ai/workspace/text-to-3d/0192d4ee-58f0-7b6c-a81d-8426cbfeea41',
    )).toBe(true);

    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/different-task-id',
      'https://www.meshy.ai/workspace/text-to-3d/0192d4ee-58f0-7b6c-a81d-8426cbfeea41',
    )).toBe(false);
  });
});
