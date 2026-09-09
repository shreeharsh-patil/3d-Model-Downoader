import { describe, expect, it } from 'vitest';
import { getTripoModelKey, TripoModelStore } from '../src/lib/providers/tripo/model-state';

describe('TripoModelStore', () => {
  it('normalizes signed asset URLs without treating query changes as new models', () => {
    expect(getTripoModelKey('https://cdn.example.com/tripo/model.glb?token=one')).toBe(
      'https://cdn.example.com/tripo/model.glb',
    );
    expect(getTripoModelKey('javascript:alert(1)')).toBeUndefined();
  });

  it('keeps a high-confidence API model active over incidental resource detections', () => {
    const store = new TripoModelStore();
    const api = store.consider({
      url: 'https://cdn.example.com/tripo/task-123/model.glb?token=one',
      detectedAt: 1,
      source: 'api-response',
    }, 'task-123');
    const incidental = store.consider({
      url: 'https://cdn.example.com/tripo/old-task/model.glb',
      detectedAt: 2,
      source: 'performance',
    }, 'task-123');

    expect(api?.changed).toBe(true);
    expect(incidental?.activated).toBe(false);
    expect(store.active?.url).toContain('task-123');
    expect(store.generation).toBe(1);
  });

  it('updates the same candidate without advancing its generation', () => {
    const store = new TripoModelStore();
    const first = store.consider({
      url: 'https://cdn.example.com/tripo/model.glb?token=one',
      detectedAt: 1,
      source: 'network',
    });
    const update = store.consider({
      url: 'https://cdn.example.com/tripo/model.glb?token=two',
      detectedAt: 2,
      source: 'api-response',
      previewUrl: 'https://cdn.example.com/preview.webp',
    });

    expect(first?.changed).toBe(true);
    expect(update?.changed).toBe(false);
    expect(store.generation).toBe(1);
    expect(store.active?.previewUrl).toContain('preview.webp');
  });

  it('prioritizes animated or rigged GLB assets over static base models', () => {
    const store = new TripoModelStore();
    // Static base model arrives first
    const staticModel = store.consider({
      url: 'https://cdn.example.com/tripo/demon-warrior/model.glb',
      detectedAt: 1,
      source: 'api-response',
    }, 'demon-warrior');

    expect(staticModel?.activated).toBe(true);
    expect(store.active?.url).toContain('model.glb');

    // Auto-rigged / animated GLB arrives via network or api-response
    const animModel = store.consider({
      url: 'https://cdn.example.com/tripo/demon-warrior/animation.glb',
      detectedAt: 2,
      source: 'network',
    }, 'demon-warrior');

    expect(animModel?.activated).toBe(true);
    expect(store.active?.url).toContain('animation.glb');
  });
});
