import { describe, expect, it } from 'vitest';
import { findMeshyAssetUrlsInObject } from '../src/lib/meshy-main-world-hook';
import { findGlbUrlsInObject } from '../src/lib/tripo-main-world-hook';
import { meshyProvider } from '../src/lib/providers/meshy/meshy-provider';
import { MeshyModelStore } from '../src/lib/meshy/model-state';

describe('current provider network asset detection', () => {
  it('recognizes Meshy on the bare workspace domain and direct GLBs', () => {
    expect(meshyProvider.matchesUrl('https://meshy.ai/workspace')).toBe(true);
    expect(meshyProvider.matchesUrl('https://www.meshy.ai/workspace')).toBe(true);
    expect(meshyProvider.isBinaryAsset('https://cdn.meshy.ai/tasks/abc/model.meshy?token=1')).toBe(true);
    expect(meshyProvider.isBinaryAsset('https://cdn.meshy.ai/tasks/abc/preview.glb?token=1')).toBe(true);
  });

  it('extracts absolute and relative Meshy assets from arbitrary JSON routes', () => {
    const urls = findMeshyAssetUrlsInObject({
      result: {
        model_url: '../assets/final.glb?signature=one',
        source: 'https://cdn.meshy.ai/task/123/model.meshy?signature=two',
      },
    }, 'https://meshy.ai/api/v3/generations/123');

    expect(urls).toEqual([
      'https://meshy.ai/api/v3/assets/final.glb?signature=one',
      'https://cdn.meshy.ai/task/123/model.meshy?signature=two',
    ]);
  });

  it('activates a binary-first Meshy model when the selected asset changes', () => {
    const store = new MeshyModelStore();
    const first = store.noteBinary('https://cdn.meshy.ai/task/one', 'https://cdn.meshy.ai/task/one/model.meshy', 1);
    const second = store.noteBinary('https://cdn.meshy.ai/task/two', 'https://cdn.meshy.ai/task/two/final.glb', 2);

    expect(first.generation).toBe(1);
    expect(second.generation).toBe(2);
    expect(store.currentModelKey).toContain('/task/two');
  });

  it('extracts relative and protocol-relative Tripo GLBs from JSON', () => {
    const urls = findGlbUrlsInObject({
      outputs: [
        { model: '/assets/task/final_meshopt.glb?token=one' },
        { model: '//tripo-data-public.rg1.data.tripo3d.com/tasks/2/model.glb?token=two' },
      ],
    }, 'https://studio.tripo3d.ai/api/v2/tasks/1');

    expect(urls).toEqual([
      'https://studio.tripo3d.ai/assets/task/final_meshopt.glb?token=one',
      'https://tripo-data-public.rg1.data.tripo3d.com/tasks/2/model.glb?token=two',
    ]);
  });
});
