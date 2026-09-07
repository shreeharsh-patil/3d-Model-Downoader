import { beforeEach, describe, expect, it } from 'vitest';
import { tabStateManager } from '../src/lib/tab-state';
import type { DetectedModel } from '../src/lib/types';

describe('Thumbnail & Preview URL Propagation', () => {
  beforeEach(() => {
    tabStateManager.clear();
  });

  it('preserves previewUrl on detected model in tab state', () => {
    const tabId = 42;
    const tab = tabStateManager.getOrCreate(tabId, 'https://studio.tripo3d.ai/workspace/task-123');

    const model: DetectedModel = {
      id: 'task-123',
      provider: 'tripo',
      name: 'Cyberpunk Helmet',
      pageUrl: 'https://studio.tripo3d.ai/workspace/task-123',
      assetUrl: 'https://tripo-data.s3.amazonaws.com/models/model.glb',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
      previewUrl: 'https://tripo-data.s3.amazonaws.com/thumbnails/task-123.webp',
      metadata: {
        vertexCount: 15400,
        triangleCount: 28900,
        meshCount: 3,
      },
    };

    tabStateManager.updateModel(tabId, model, tab.revision);

    const stored = tabStateManager.get(tabId);
    expect(stored?.model?.previewUrl).toBe('https://tripo-data.s3.amazonaws.com/thumbnails/task-123.webp');
    expect(stored?.model?.name).toBe('Cyberpunk Helmet');
  });

  it('updates previewUrl when higher revision or refined model arrives', () => {
    const tabId = 15;
    const tab = tabStateManager.getOrCreate(tabId, 'https://www.meshy.ai/workspace/text-to-3d/modelX');

    // Initial detection without thumbnail
    const initialModel: DetectedModel = {
      id: 'modelX',
      provider: 'meshy',
      name: 'Sci-fi Pistol',
      pageUrl: 'https://www.meshy.ai/workspace/text-to-3d/modelX',
      format: 'glb',
      detectedAt: Date.now(),
      status: 'ready',
    };

    tabStateManager.updateModel(tabId, initialModel, tab.revision);
    expect(tabStateManager.get(tabId)?.model?.previewUrl).toBeUndefined();

    // Model update with thumbnail
    const updatedModel: DetectedModel = {
      ...initialModel,
      previewUrl: 'https://assets.meshy.ai/tasks/modelX/thumbnail.png',
    };

    tabStateManager.updateModel(tabId, updatedModel, tab.revision);
    expect(tabStateManager.get(tabId)?.model?.previewUrl).toBe(
      'https://assets.meshy.ai/tasks/modelX/thumbnail.png',
    );
  });
});
