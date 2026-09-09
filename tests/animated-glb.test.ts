import { describe, expect, it } from 'vitest';
import { GLB_JSON_CHUNK_TYPE, GLB_MAGIC, GLB_VERSION, validateGlb } from '../src/lib/glb-validator';
import { buildGlbFromDocument, mergeGlbAnimations, normalizeBoneName, parseGlbDocument } from '../src/lib/meshy/animation-merger';
import { normalizeQuantizedPositionsInGlb, parseGlb } from '../src/lib/meshy/gltf-normalizer';
import { getMeshyPageModelHint, isMeshyModelKeyCorrelatedWithPage } from '../src/lib/meshy/model-correlation';
import { MeshyModelStore } from '../src/lib/meshy/model-state';
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

  it('normalizes bone names across different rigging naming conventions', () => {
    expect(normalizeBoneName('mixamorig:Hips')).toBe('hips');
    expect(normalizeBoneName('Hips')).toBe('hips');
    expect(normalizeBoneName('mixamorig_Hips')).toBe('hips');
    expect(normalizeBoneName('DEF-Hips')).toBe('hips');
    expect(normalizeBoneName('Armature|LeftUpLeg')).toBe('leftupleg');
    expect(normalizeBoneName('Left_Up_Leg')).toBe('leftupleg');
    expect(normalizeBoneName('Bip01_Pelvis')).toBe('pelvis');
    expect(normalizeBoneName('mixamorig:Spine1')).toBe('spine1');
    expect(normalizeBoneName('')).toBe('');
    expect(normalizeBoneName(undefined)).toBe('');
  });

  function createTestGlb(gltf: Record<string, unknown>, binLength = 64): ArrayBuffer {
    const bin = new Uint8Array(binLength);
    const gltfDoc = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: binLength }],
      ...gltf,
    };
    return buildGlbFromDocument(gltfDoc as any, bin);
  }

  function makeMeshAndRigGlb(): ArrayBuffer {
    return createTestGlb({
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
      nodes: [
        { name: 'CharacterMesh', mesh: 0 },
        { name: 'mixamorig:Hips' },
        { name: 'mixamorig:Spine' },
      ],
      skins: [
        { joints: [1, 2] },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 64 },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: 'VEC3' },
        { bufferView: 0, byteOffset: 24, componentType: 5121, count: 2, type: 'VEC4' },
        { bufferView: 0, byteOffset: 32, componentType: 5126, count: 2, type: 'VEC4' },
      ],
    }, 64);
  }

  function makeMotionClipGlb(animName = 'Dance'): ArrayBuffer {
    return createTestGlb({
      nodes: [
        { name: 'Hips' },
        { name: 'Spine' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 72 },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: 'SCALAR' }, // timestamps (2 * 4 = 8 bytes)
        { bufferView: 0, byteOffset: 8, componentType: 5126, count: 2, type: 'VEC4' }, // rotations for Hips (2 * 16 = 32 bytes, offset 8..40)
        { bufferView: 0, byteOffset: 40, componentType: 5126, count: 2, type: 'VEC4' }, // rotations for Spine (2 * 16 = 32 bytes, offset 40..72)
      ],
      animations: [
        {
          name: animName,
          samplers: [
            { input: 0, interpolation: 'LINEAR', output: 1 },
            { input: 0, interpolation: 'LINEAR', output: 2 },
          ],
          channels: [
            { sampler: 0, target: { node: 0, path: 'rotation' } }, // targets node 0 ('Hips')
            { sampler: 1, target: { node: 1, path: 'rotation' } }, // targets node 1 ('Spine')
          ],
        },
      ],
    }, 72);
  }

  it('merges a character mesh GLB and motion clip GLB into a single animated GLB with remapped bone channels', () => {
    const meshGlb = makeMeshAndRigGlb();
    const animGlb = makeMotionClipGlb('Dance');

    const result = mergeGlbAnimations(meshGlb, animGlb);

    expect(result.merged).toBe(true);
    expect(result.meshCount).toBe(1);
    expect(result.animationCount).toBe(1);

    const validation = validateGlb(result.buffer);
    expect(validation.valid).toBe(true);
    expect(validation.metadata?.meshCount).toBe(1);
    expect(validation.metadata?.animationCount).toBe(1);
    expect(validation.metadata?.skinCount).toBe(1);

    const parsed = parseGlbDocument(result.buffer);
    expect(parsed).not.toBeNull();
    const anim = parsed!.gltf.animations![0];
    expect(anim.name).toBe('Dance');
    // Channel 0 (was node 0 'Hips') must map to node 1 ('mixamorig:Hips' in base)
    expect(anim.channels[0].target.node).toBe(1);
    // Channel 1 (was node 1 'Spine') must map to node 2 ('mixamorig:Spine' in base)
    expect(anim.channels[1].target.node).toBe(2);

    // Sampler input/output accessors must be remapped by base accessor count (3)
    expect(anim.samplers[0].input).toBe(3);
    expect(anim.samplers[0].output).toBe(4);
    expect(anim.samplers[1].input).toBe(3);
    expect(anim.samplers[1].output).toBe(5);
  });

  it('handles swapped parameter order when merging mesh and animation', () => {
    const meshGlb = makeMeshAndRigGlb();
    const animGlb = makeMotionClipGlb('Walk');

    // Pass animGlb as first argument and meshGlb as second argument
    const result = mergeGlbAnimations(animGlb, meshGlb);

    expect(result.merged).toBe(true);
    expect(result.meshCount).toBe(1);
    expect(result.animationCount).toBe(1);

    const validation = validateGlb(result.buffer);
    expect(validation.valid).toBe(true);
    expect(validation.metadata?.meshCount).toBe(1);
    expect(validation.metadata?.animationCount).toBe(1);
  });

  it('MeshyModelStore automatically merges motion clips with character meshes when mesh arrives first', () => {
    const store = new MeshyModelStore();
    const modelKey = 'https://assets.meshy.ai/tasks/task-anim-test-1';
    store.activateCandidate({ provider: 'meshy', modelKey, detectedAt: 1 });

    const meshGlb = makeMeshAndRigGlb();
    const animGlb = makeMotionClipGlb('Run');

    // 1. Mesh arrives
    store.acceptDecodedGlb(meshGlb, modelKey, `${modelKey}/model.meshy`);
    expect(store.current).not.toBeNull();
    expect(store.current?.metadata?.meshCount).toBe(1);
    expect(store.current?.metadata?.animationCount).toBe(0);

    // 2. Animation clip arrives
    store.acceptDecodedGlb(animGlb, modelKey, `${modelKey}/animation.glb`);
    expect(store.current).not.toBeNull();
    // The current GLB must now contain BOTH the mesh AND the animation!
    expect(store.current?.metadata?.meshCount).toBe(1);
    expect(store.current?.metadata?.animationCount).toBe(1);

    const validation = validateGlb(store.current!.buffer);
    expect(validation.valid).toBe(true);
    expect(validation.metadata?.meshCount).toBe(1);
    expect(validation.metadata?.animationCount).toBe(1);
  });

  it('MeshyModelStore automatically merges motion clips with character meshes when animation arrives first', () => {
    const store = new MeshyModelStore();
    const modelKey = 'https://assets.meshy.ai/tasks/task-anim-test-2';
    store.activateCandidate({ provider: 'meshy', modelKey, detectedAt: 1 });

    const meshGlb = makeMeshAndRigGlb();
    const animGlb = makeMotionClipGlb('Jump');

    // 1. Animation clip arrives first
    store.acceptDecodedGlb(animGlb, modelKey, `${modelKey}/animation.glb`);
    expect(store.current?.metadata?.animationCount).toBe(1);

    // 2. Mesh arrives second
    store.acceptDecodedGlb(meshGlb, modelKey, `${modelKey}/model.meshy`);
    expect(store.current).not.toBeNull();
    // The current GLB must now contain BOTH the mesh AND the animation!
    expect(store.current?.metadata?.meshCount).toBe(1);
    expect(store.current?.metadata?.animationCount).toBe(1);

    const validation = validateGlb(store.current!.buffer);
    expect(validation.valid).toBe(true);
    expect(validation.metadata?.meshCount).toBe(1);
    expect(validation.metadata?.animationCount).toBe(1);
  });

  it('MeshyModelStore merges multiple animation clips into a single model', () => {
    const store = new MeshyModelStore();
    const modelKey = 'https://assets.meshy.ai/tasks/task-anim-test-3';
    store.activateCandidate({ provider: 'meshy', modelKey, detectedAt: 1 });

    const meshGlb = makeMeshAndRigGlb();
    const walkGlb = makeMotionClipGlb('Walk');
    const danceGlb = makeMotionClipGlb('Dance');

    // 1. Mesh arrives
    store.acceptDecodedGlb(meshGlb, modelKey, `${modelKey}/model.meshy`);

    // 2. First animation clip arrives
    store.acceptDecodedGlb(walkGlb, modelKey, `${modelKey}/walk.glb`);
    expect(store.current?.metadata?.animationCount).toBe(1);

    // 3. Second animation clip arrives
    store.acceptDecodedGlb(danceGlb, modelKey, `${modelKey}/dance.glb`);
    expect(store.current?.metadata?.meshCount).toBe(1);
    expect(store.current?.metadata?.animationCount).toBe(2);

    const validation = validateGlb(store.current!.buffer);
    expect(validation.valid).toBe(true);
    expect(validation.metadata?.meshCount).toBe(1);
    expect(validation.metadata?.animationCount).toBe(2);
  });

  it('MeshyModelStore correctly identifies dummy mannequin motion clips (Armature_meshData) and preserves the high-poly character mesh', () => {
    const store = new MeshyModelStore();
    const modelKey = 'https://assets.meshy.ai/tasks/task-mannequin-test';
    store.activateCandidate({ provider: 'meshy', modelKey, detectedAt: 1 });

    const characterMeshGlb = makeMeshAndRigGlb(); // Real character mesh
    const dummyMotionGlb = createTestGlb({
      meshes: [
        {
          name: 'Armature_meshData',
          primitives: [{ attributes: { POSITION: 0 } }],
        },
      ],
      nodes: [
        { name: 'Armature_mesh', mesh: 0 },
        { name: 'Hips', children: [2] },
        { name: 'Spine' },
        { name: 'Armature', children: [0, 1] },
      ],
      skins: [{ name: 'Armature', joints: [1, 2] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72 }],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: 'SCALAR' },
        { bufferView: 0, byteOffset: 8, componentType: 5126, count: 2, type: 'VEC4' },
        { bufferView: 0, byteOffset: 40, componentType: 5126, count: 2, type: 'VEC4' },
      ],
      animations: [
        {
          name: 'Running',
          samplers: [
            { input: 0, interpolation: 'LINEAR', output: 1 },
            { input: 0, interpolation: 'LINEAR', output: 2 },
          ],
          channels: [
            { sampler: 0, target: { node: 1, path: 'rotation' } },
            { sampler: 1, target: { node: 2, path: 'rotation' } },
          ],
        },
      ],
    }, 72);

    // 1. Character mesh arrives first
    store.acceptDecodedGlb(characterMeshGlb, modelKey, `${modelKey}/model.meshy`);

    // 2. Dummy mannequin motion clip arrives
    store.acceptDecodedGlb(dummyMotionGlb, modelKey, `${modelKey}/motion.glb`);

    expect(store.current).not.toBeNull();
    // Character mesh must NOT have been replaced by the dummy mannequin!
    expect(store.current?.metadata?.meshCount).toBe(1);
    expect(store.current?.metadata?.animationCount).toBe(1);
    expect(store.current?.metadata?.skinCount).toBe(1);

    const doc = parseGlbDocument(store.current!.buffer);
    expect(doc).not.toBeNull();
    // The mesh in the merged GLB must be the character mesh, not Armature_meshData
    expect(doc!.gltf.meshes?.[0]?.name).not.toBe('Armature_meshData');
    expect(doc!.gltf.animations?.[0]?.name).toBe('Running');
  });
});

