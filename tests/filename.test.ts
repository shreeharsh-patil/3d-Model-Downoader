import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../src/lib/filename';

describe('Filename Sanitization', () => {
  it('removes slashes and Windows reserved filesystem characters', () => {
    const dirty = 'cool/model\\with:invalid*characters?and"quotes<and>pipes|';
    const clean = sanitizeFilename(dirty, 'meshy', 'glb');

    expect(clean).not.toMatch(/[\\/:*?"<>|]/);
    expect(clean.endsWith('.glb')).toBe(true);
  });

  it('shortens excessively long names', () => {
    const longName = 'a'.repeat(200);
    const clean = sanitizeFilename(longName, 'meshy', 'glb');

    // Base name should be at most 80 chars + suffix + ext
    expect(clean.length).toBeLessThan(110);
    expect(clean.endsWith('.glb')).toBe(true);
  });

  it('provides predictable fallback for empty or whitespace-only names', () => {
    const fallback1 = sanitizeFilename('', 'meshy', 'glb');
    const fallback2 = sanitizeFilename('   ', 'tripo', 'glb');
    const fallbackNull = sanitizeFilename(undefined, 'meshy', 'glb');

    expect(fallback1).toMatch(/^meshy-model-\d{8}-\d{4}\.glb$/);
    expect(fallback2).toMatch(/^tripo-model-\d{8}-\d{4}\.glb$/);
    expect(fallbackNull).toMatch(/^meshy-model-\d{8}-\d{4}\.glb$/);
  });

  it('ensures provider name is included in filename', () => {
    const name = sanitizeFilename('cyberpunk_warrior', 'meshy', 'glb');
    expect(name).toContain('meshy');
    expect(name).toBe('cyberpunk_warrior_meshy.glb');

    const alreadyTagged = sanitizeFilename('warrior_meshy', 'meshy', 'glb');
    expect(alreadyTagged).toBe('warrior_meshy.glb');
  });

  it('maps textures export format to .zip extension', () => {
    const zipName = sanitizeFilename('cyber_car', 'luma', 'textures');
    expect(zipName).toBe('cyber_car_luma.zip');

    const rodinZip = sanitizeFilename('sculpture', 'rodin', 'textures');
    expect(rodinZip).toBe('sculpture_rodin.zip');
  });

  it('handles Sketchfab, Poly Pizza, and Poly Haven provider tags', () => {
    const sketchfabModel = sanitizeFilename('sci-fi-helmet', 'sketchfab', 'glb');
    expect(sketchfabModel).toBe('sci-fi-helmet_sketchfab.glb');

    const pizzaModel = sanitizeFilename('low_poly_tree', 'polypizza', 'stl');
    expect(pizzaModel).toBe('low_poly_tree_polypizza.stl');

    const havenModel = sanitizeFilename('brass_vase', 'polyhaven', 'obj');
    expect(havenModel).toBe('brass_vase_polyhaven.obj');
  });
});
