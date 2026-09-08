import { describe, expect, it } from 'vitest';
import { findProvider, isSupportedUrl } from '../src/lib/providers/registry';

describe('Provider Detection', () => {
  it('detects Meshy URLs correctly', () => {
    expect(findProvider('https://www.meshy.ai/workspace')?.id).toBe('meshy');
    expect(findProvider('https://www.meshy.ai/workspace/text-to-3d/12345')?.id).toBe('meshy');
    expect(findProvider('https://meshy.ai')?.id).toBe('meshy');
    expect(findProvider('https://meshy.ai/')?.id).toBe('meshy');
    expect(findProvider('https://meshy.ai?ref=test')?.id).toBe('meshy');
    expect(isSupportedUrl('https://www.meshy.ai/')).toBe(true);
  });

  it('detects Tripo3D URLs correctly across various paths and query params', () => {
    expect(findProvider('https://studio.tripo3d.ai')?.id).toBe('tripo');
    expect(findProvider('https://studio.tripo3d.ai/')?.id).toBe('tripo');
    expect(findProvider('https://studio.tripo3d.ai?tab=models&page=1')?.id).toBe('tripo');
    expect(findProvider('https://studio.tripo3d.ai/#/workspace')?.id).toBe('tripo');
    expect(findProvider('https://studio.tripo3d.ai/app')?.id).toBe('tripo');
    expect(findProvider('https://app.tripo3d.ai/workspace')?.id).toBe('tripo');
    expect(findProvider('https://tripo3d.ai/workspace')?.id).toBe('tripo');
    expect(findProvider('https://www.tripo3d.ai/')?.id).toBe('tripo');
    expect(findProvider('https://tripo3d.com/app')?.id).toBe('tripo');
    expect(isSupportedUrl('https://studio.tripo3d.ai')).toBe(true);
    expect(isSupportedUrl('https://studio.tripo3d.ai?query=1')).toBe(true);
  });

  it('detects Luma AI URLs correctly', () => {
    expect(findProvider('https://lumalabs.ai/genie')?.id).toBe('luma');
    expect(findProvider('https://lumalabs.ai')?.id).toBe('luma');
    expect(findProvider('https://lumalabs.ai/workspace/12345')?.id).toBe('luma');
    expect(findProvider('https://cdn.lumalabs.ai/genie/model.glb')?.id).toBe('luma');
    expect(isSupportedUrl('https://lumalabs.ai/genie')).toBe(true);
  });

  it('detects Rodin / Hyper3D URLs correctly', () => {
    expect(findProvider('https://hyperhuman.deemos.com/rodin')?.id).toBe('rodin');
    expect(findProvider('https://hyperhuman.deemos.com/model/abc')?.id).toBe('rodin');
    expect(findProvider('https://hyperhuman.top/rodin')?.id).toBe('rodin');
    expect(findProvider('https://hyper3d.ai/app')?.id).toBe('rodin');
    expect(findProvider('https://deemos.com')?.id).toBe('rodin');
    expect(isSupportedUrl('https://hyperhuman.deemos.com/rodin')).toBe(true);
  });

  it('detects Sketchfab URLs correctly', () => {
    expect(findProvider('https://sketchfab.com/3d-models/drone-4f81c9b2e3d4416bb8972e617d3cf021')?.id).toBe('sketchfab');
    expect(findProvider('https://sketchfab.com/feed')?.id).toBe('sketchfab');
    expect(findProvider('https://sketchfab.com')?.id).toBe('sketchfab');
    expect(isSupportedUrl('https://sketchfab.com/feed')).toBe(true);
  });

  it('detects Poly Pizza URLs correctly', () => {
    expect(findProvider('https://poly.pizza/m/4eGf9a')?.id).toBe('polypizza');
    expect(findProvider('https://poly.pizza')?.id).toBe('polypizza');
    expect(findProvider('https://polypizza.net/m/123')?.id).toBe('polypizza');
    expect(isSupportedUrl('https://poly.pizza/m/123')).toBe(true);
  });

  it('detects Poly Haven URLs correctly', () => {
    expect(findProvider('https://polyhaven.com/a/brass_vase')?.id).toBe('polyhaven');
    expect(findProvider('https://polyhaven.com/models')?.id).toBe('polyhaven');
    expect(findProvider('https://polyhaven.org/a/chair')?.id).toBe('polyhaven');
    expect(isSupportedUrl('https://polyhaven.com')).toBe(true);
  });

  it('rejects unsupported URLs', () => {
    expect(findProvider('https://github.com/shreeharsh-patil/3d-Model-Downoader')).toBeUndefined();
    expect(findProvider('https://google.com')).toBeUndefined();
    expect(findProvider('https://artstation.com/artwork/123')).toBeUndefined();
    expect(findProvider('')).toBeUndefined();
    expect(findProvider(undefined)).toBeUndefined();
    expect(isSupportedUrl('https://github.com')).toBe(false);
  });
});
