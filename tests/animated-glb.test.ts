import { describe, expect, it } from 'vitest';
import { GLB_JSON_CHUNK_TYPE, GLB_MAGIC, GLB_VERSION, validateGlb } from '../src/lib/glb-validator';
import { normalizeQuantizedPositionsInGlb, parseGlb } from '../src/lib/meshy/gltf-normalizer';
import { getMeshyPageModelHint, isMeshyModelKeyCorrelatedWithPage } from '../src/lib/meshy/model-correlation';
import { meshyProvider } from '../src/lib/providers/meshy/meshy-provider';

function createValidGlbBuffer(gltfJson: Record<string, unknown> = {}): ArrayBuffer {
  const jsonStr = JSON.stringify(gltfJson);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const paddedJsonLength = (jsonBytes.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Header
  view.setUint32(0, GLB_MAGIC, true); // "glTF"
  view.setUint32(4, GLB_VERSION, true); // 2
  view.setUint32(8, totalLength, true);

  // JSON chunk header
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);

  // Pad with spaces
  uint8.fill(0x20, 20, 20 + paddedJsonLength);
  uint8.set(jsonBytes, 20);

  return buffer;
}

describe('Animated GLB Support', () => {
  it('validates and extracts metadata for rigged and animated GLB models', () => {
    const gltf = {
      asset: { version: '2.0' },
      meshes: [
        {
          primitives: [
            {
              attributes: {
                POSITION: 0,
                NORMAL: 1,
                JOINTS_0: 2,
                WEIGHTS_0: 3,
              },
              indices: 4,
            },
          ],
        },
      ],
      accessors: [
        { componentType: 5126, count: 100, type: 'VEC3' }, // POSITION
        { componentType: 5126, count: 100, type: 'VEC3' }, // NORMAL
        { componentType: 5121, count: 100, type: 'VEC4' }, // JOINTS_0 (UNSIGNED_BYTE)
        { componentType: 5126, count: 100, type: 'VEC4' }, // WEIGHTS_0 (FLOAT)
        { componentType: 5123, count: 300, type: 'SCALAR' }, // indices (100 triangles)
        { componentType: 5126, count: 16, type: 'MAT4' }, // inverseBindMatrices
        { componentType: 5126, count: 20, type: 'SCALAR' }, // animation timestamps (input)
        { componentType: 5126, count: 20, type: 'VEC4' }, // animation rotation keyframes (output)
        { componentType: 5126, count: 20, type: 'VEC3' }, // animation translation keyframes (output)
      ],
      skins: [
        {
          inverseBindMatrices: 5,
          joints: [1, 2, 3],
        },
      ],
      animations: [
        {
          name: 'Walk',
          channels: [
            { sampler: 0, target: { node: 1, path: 'rotation' } },
            { sampler: 1, target: { node: 2, path: 'translation' } },
          ],
          samplers: [
            { input: 6, interpolation: 'LINEAR', output: 7 },
            { input: 6, interpolation: 'LINEAR', output: 8 },
          ],
        },
      ],
    };

    const buffer = createValidGlbBuffer(gltf);
    const result = validateGlb(buffer);

    expect(result.valid).toBe(true);
    expect(result.metadata?.meshCount).toBe(1);
    expect(result.metadata?.animationCount).toBe(1);
    expect(result.metadata?.skinCount).toBe(1);
    expect(result.metadata?.vertexCount).toBe(100);
    expect(result.metadata?.triangleCount).toBe(100);
  });

  it('accepts animation-only GLB motion clips (0 meshes, >0 animations)', () => {
    const gltf = {
      asset: { version: '2.0' },
      accessors: [
        { componentType: 5126, count: 10, type: 'SCALAR' }, // input timestamps
        { componentType: 5126, count: 10, type: 'VEC4' }, // output rotations
      ],
      animations: [
        {
          name: 'DanceClip',
          channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
          samplers: [{ input: 0, interpolation: 'LINEAR', output: 1 }],
        },
      ],
    };

    const buffer = createValidGlbBuffer(gltf);
    const result = validateGlb(buffer);

    expect(result.valid).toBe(true);
    expect(result.metadata?.meshCount).toBe(0);
    expect(result.metadata?.animationCount).toBe(1);
  });

  it('preserves animation and skinning hierarchy during GLB parsing and normalization', () => {
    const gltf = {
      asset: { version: '2.0' },
      meshes: [
        {
          primitives: [
            {
              attributes: {
                POSITION: 0,
                JOINTS_0: 1,
                WEIGHTS_0: 2,
              },
            },
          ],
        },
      ],
      accessors: [
        { componentType: 5126, count: 10, type: 'VEC3' },
        { componentType: 5121, count: 10, type: 'VEC4' },
        { componentType: 5126, count: 10, type: 'VEC4' },
        { componentType: 5126, count: 5, type: 'SCALAR' },
        { componentType: 5126, count: 5, type: 'VEC4' },
      ],
      skins: [{ joints: [0, 1] }],
      animations: [
        {
          name: 'Idle',
          channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
          samplers: [{ input: 3, output: 4 }],
        },
      ],
    };

    const buffer = createValidGlbBuffer(gltf);
    const parsed = parseGlb(buffer);
    expect(parsed).toBeNull(); // No BIN chunk in minimal JSON-only GLB, so normalization leaves it untouched

    const normalized = normalizeQuantizedPositionsInGlb(buffer);
    expect(normalized).toBe(buffer); // Unmodified
  });

  it('detects Meshy animation and rigging routes in URL matching and model ID extraction', () => {
    const animUrl = 'https://www.meshy.ai/workspace/animation/0192d4ee-58f0-7b6c-a841-35b801a615aa';
    expect(meshyProvider.matchesUrl(animUrl)).toBe(true);
    expect(meshyProvider.extractModelId(animUrl)).toBe('0192d4ee-58f0-7b6c-a841-35b801a615aa');

    const riggingUrl = 'https://www.meshy.ai/workspace/rigging/01955e4e-0d12-7000-b302-601fa62529ca';
    expect(meshyProvider.matchesUrl(riggingUrl)).toBe(true);
    expect(meshyProvider.extractModelId(riggingUrl)).toBe('01955e4e-0d12-7000-b302-601fa62529ca');

    const queryAnimUrl = 'https://www.meshy.ai/workspace/animation?animationId=anim-run-001';
    expect(meshyProvider.extractModelId(queryAnimUrl)).toBe('anim-run-001');
  });

  it('recognizes animation binary assets and JSON definitions', () => {
    expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/task-1/animation.glb')).toBe(true);
    expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/task-1/rigged.glb')).toBe(true);
    expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/task-1/motion.glb')).toBe(true);
    expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/task-1/animation.meshy')).toBe(true);
    expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/task-1/rigged.meshy')).toBe(true);

    expect(meshyProvider.isModelAsset('https://assets.meshy.ai/tasks/task-1/animation.json')).toBe(true);
    expect(meshyProvider.isModelAsset('https://assets.meshy.ai/tasks/task-1/rig.json')).toBe(true);
  });

  it('correlates animation and motion assets with the active workspace page', () => {
    const pageUrl = 'https://www.meshy.ai/workspace/text-to-3d/0192d4ee-58f0-7b6c-a841-35b801a615aa';

    // Same task ID
    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/0192d4ee-58f0-7b6c-a841-35b801a615aa',
      pageUrl,
    )).toBe(true);

    // Animation or motion asset with separate task ID generated from the same model
    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/anim-task-999',
      pageUrl,
    )).toBe(true);

    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/rig-task-888',
      pageUrl,
    )).toBe(true);

    // Animation page URL correlates any task asset
    const animPageUrl = 'https://www.meshy.ai/workspace/animation/0192d4ee-58f0-7b6c-a841-35b801a615aa';
    expect(isMeshyModelKeyCorrelatedWithPage(
      'https://assets.meshy.ai/tasks/preset-dance-01',
      animPageUrl,
    )).toBe(true);
  });
});
