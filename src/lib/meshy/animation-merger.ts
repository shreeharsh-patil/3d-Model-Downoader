import { GLB_BIN_CHUNK_TYPE, GLB_JSON_CHUNK_TYPE, GLB_MAGIC, GLB_VERSION, validateGlb } from '../glb-validator';
import { logger } from '../logger';

export function align4(value: number): number {
  return (value + 3) & ~3;
}

export type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: {
    count: number;
    indices: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
    };
    values: {
      bufferView: number;
      byteOffset?: number;
    };
  };
};

export type GltfBufferView = {
  buffer?: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
};

export type GltfAnimationChannel = {
  sampler: number;
  target: {
    node?: number;
    path: 'translation' | 'rotation' | 'scale' | 'weights' | string;
    extensions?: Record<string, unknown>;
  };
};

export type GltfAnimationSampler = {
  input: number;
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' | string;
  output: number;
};

export type GltfAnimation = {
  name?: string;
  channels: GltfAnimationChannel[];
  samplers: GltfAnimationSampler[];
  extensions?: Record<string, unknown>;
  extras?: unknown;
};

export type GltfNode = {
  name?: string;
  camera?: number;
  children?: number[];
  skin?: number;
  matrix?: number[];
  mesh?: number;
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  translation?: [number, number, number];
  weights?: number[];
  extensions?: Record<string, unknown>;
  extras?: unknown;
};

export type GltfSkin = {
  inverseBindMatrices?: number;
  skeleton?: number;
  joints: number[];
  name?: string;
};

export type GltfDocument = {
  asset: { version: string; generator?: string; [key: string]: unknown };
  scene?: number;
  scenes?: Array<{ name?: string; nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{
    name?: string;
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
      targets?: Array<Record<string, number>>;
    }>;
    weights?: number[];
  }>;
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: Array<{ byteLength: number }>;
  materials?: Array<Record<string, unknown>>;
  textures?: Array<Record<string, unknown>>;
  images?: Array<Record<string, unknown>>;
  samplers?: Array<Record<string, unknown>>;
  skins?: GltfSkin[];
  animations?: GltfAnimation[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [key: string]: unknown;
};

export interface ParsedGlb {
  gltf: GltfDocument;
  bin: Uint8Array;
}

export interface AnimationMergeResult {
  buffer: ArrayBuffer;
  merged: boolean;
  animationCount: number;
  meshCount: number;
  error?: string;
}

export function parseGlbDocument(buffer: ArrayBuffer): ParsedGlb | null {
  if (buffer.byteLength < 20) return null;

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION) return null;

  const declaredLength = view.getUint32(8, true);
  if (declaredLength > buffer.byteLength) return null;

  let offset = 12;
  let jsonChunkData: Uint8Array | null = null;
  let binChunkData: Uint8Array | null = null;

  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > declaredLength) return null;

    if (chunkType === GLB_JSON_CHUNK_TYPE && !jsonChunkData) {
      jsonChunkData = new Uint8Array(buffer, chunkStart, chunkLength);
    } else if (chunkType === GLB_BIN_CHUNK_TYPE && !binChunkData) {
      binChunkData = new Uint8Array(buffer, chunkStart, chunkLength);
    }
    offset = chunkEnd;
  }

  if (!jsonChunkData) return null;

  try {
    const jsonText = new TextDecoder()
      .decode(jsonChunkData)
      .replace(/[\u0000\s]+$/u, '');

    const gltf = JSON.parse(jsonText) as GltfDocument;
    const bin = binChunkData ?? new Uint8Array(0);

    return { gltf, bin };
  } catch {
    return null;
  }
}

export function buildGlbFromDocument(gltf: GltfDocument, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedJsonLength = align4(jsonBytes.byteLength);
  const paddedBinLength = align4(bin.byteLength);
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);

  // GLB Header
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);

  // JSON chunk
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);
  bytes.fill(0x20, 20, 20 + paddedJsonLength);
  bytes.set(jsonBytes, 20);

  // BIN chunk
  const binHeaderOffset = 20 + paddedJsonLength;
  view.setUint32(binHeaderOffset, paddedBinLength, true);
  view.setUint32(binHeaderOffset + 4, GLB_BIN_CHUNK_TYPE, true);
  bytes.fill(0x00, binHeaderOffset + 8, totalLength);
  bytes.set(bin, binHeaderOffset + 8);

  return output;
}

/**
 * Normalizes bone/joint names across Mixamo, Meshy, Blender, and game engines
 * (e.g. "mixamorig:Hips" -> "hips", "DEF-Hips" -> "hips", "Left_Up_Leg" -> "leftupleg").
 */
export function normalizeBoneName(name: string | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/^.*[:|]/u, '') // Strip namespaces before : or |
    .replace(/^(mixamorig|armature|bip01|def|org|mch|rig)[_\-.: ]*/iu, '') // Strip standard rig prefixes
    .replace(/[^a-z0-9]/gu, ''); // Strip remaining delimiters
}

function isDuplicateAnimation(
  existing: GltfAnimation,
  candidate: GltfAnimation,
): boolean {
  if (existing.name && candidate.name && existing.name === candidate.name) {
    if ((existing.channels?.length ?? 0) === (candidate.channels?.length ?? 0) &&
        (existing.samplers?.length ?? 0) === (candidate.samplers?.length ?? 0)) {
      return true;
    }
  }
  return false;
}

export function isMotionClipDoc(gltf: GltfDocument, binLength = 0): boolean {
  const animCount = gltf.animations?.length ?? 0;
  if (animCount === 0) return false;
  const meshCount = gltf.meshes?.length ?? 0;
  if (meshCount === 0) return true;
  if (meshCount === 1) {
    const mesh = gltf.meshes![0];
    const name = (mesh.name ?? '').toLowerCase();
    if (
      name.includes('meshdata') ||
      name.includes('armature') ||
      name.includes('dummy') ||
      name.includes('mannequin') ||
      name.includes('preview')
    ) {
      return true;
    }
    const posAccIdx = mesh.primitives?.[0]?.attributes?.POSITION;
    const vertexCount = posAccIdx !== undefined ? gltf.accessors?.[posAccIdx]?.count ?? 0 : 0;
    if (vertexCount > 0 && vertexCount < 2000) return true;
    if (binLength > 0 && binLength < 350 * 1024) return true;
  }
  return false;
}

/**
 * Maps animation source nodes to the corresponding target skeleton/mesh nodes in baseGltf.
 */
function buildNodeIndexMap(
  baseGltf: GltfDocument,
  animGltf: GltfDocument,
): Map<number, number> {
  const nodeMap = new Map<number, number>();
  const baseNodes = baseGltf.nodes ?? [];
  const animNodes = animGltf.nodes ?? [];

  // Identify dummy preview mesh nodes in animGltf to avoid copying them
  const dummyMeshNodeIndices = new Set<number>();
  if (isMotionClipDoc(animGltf)) {
    for (let i = 0; i < animNodes.length; i++) {
      if (animNodes[i].mesh !== undefined) {
        dummyMeshNodeIndices.add(i);
      }
    }
  }

  // 1. Build lookup tables for base nodes, prioritizing skin joints
  const exactBaseNodeMap = new Map<string, number>();
  const normalizedBaseNodeMap = new Map<string, number>();
  const baseJointSet = new Set<number>();

  for (const skin of baseGltf.skins ?? []) {
    for (const joint of skin.joints ?? []) {
      baseJointSet.add(joint);
    }
  }

  // Record joint nodes first
  for (const jointIdx of baseJointSet) {
    const node = baseNodes[jointIdx];
    if (node?.name) {
      exactBaseNodeMap.set(node.name, jointIdx);
      const norm = normalizeBoneName(node.name);
      if (norm && !normalizedBaseNodeMap.has(norm)) {
        normalizedBaseNodeMap.set(norm, jointIdx);
      }
    }
  }

  // Record other base nodes
  for (let idx = 0; idx < baseNodes.length; idx += 1) {
    const node = baseNodes[idx];
    if (node?.name) {
      if (!exactBaseNodeMap.has(node.name)) {
        exactBaseNodeMap.set(node.name, idx);
      }
      const norm = normalizeBoneName(node.name);
      if (norm && !normalizedBaseNodeMap.has(norm)) {
        normalizedBaseNodeMap.set(norm, idx);
      }
    }
  }

  // Find base mesh node for morph target animations
  let baseMeshNodeIndex: number | undefined;
  for (let idx = 0; idx < baseNodes.length; idx += 1) {
    if (baseNodes[idx].mesh !== undefined) {
      baseMeshNodeIndex = idx;
      break;
    }
  }

  const baseJoints = baseGltf.skins?.[0]?.joints;
  const animJoints = animGltf.skins?.[0]?.joints;

  // Track newly created node indices
  const newlyCreatedNodeIndices: number[] = [];

  // 2. Map each node in animNodes
  for (let animIdx = 0; animIdx < animNodes.length; animIdx += 1) {
    if (dummyMeshNodeIndices.has(animIdx)) {
      continue;
    }

    const animNode = animNodes[animIdx];
    const name = animNode?.name;

    // A. Morph target / mesh target
    if (animNode?.mesh !== undefined && baseMeshNodeIndex !== undefined) {
      nodeMap.set(animIdx, baseMeshNodeIndex);
      continue;
    }

    // B. Exact name match
    if (name && exactBaseNodeMap.has(name)) {
      nodeMap.set(animIdx, exactBaseNodeMap.get(name)!);
      continue;
    }

    // C. Normalized bone name match
    const norm = normalizeBoneName(name);
    if (norm && normalizedBaseNodeMap.has(norm)) {
      nodeMap.set(animIdx, normalizedBaseNodeMap.get(norm)!);
      continue;
    }

    // D. Skin joints index alignment
    if (animJoints && baseJoints) {
      const jointPos = animJoints.indexOf(animIdx);
      if (jointPos !== -1 && jointPos < baseJoints.length) {
        nodeMap.set(animIdx, baseJoints[jointPos]);
        continue;
      }
    }

    // E. Direct index match if names are empty or match
    if (animIdx < baseNodes.length) {
      const baseNode = baseNodes[animIdx];
      if (!baseNode.name || !name || normalizeBoneName(baseNode.name) === norm) {
        nodeMap.set(animIdx, animIdx);
        continue;
      }
    }

    // F. Node does not exist in baseGltf - create a new node in baseGltf
    const newIdx = baseNodes.length;
    const newNode: GltfNode = {
      name: name || `Bone_${animIdx}`,
      translation: animNode.translation ? [...animNode.translation] : undefined,
      rotation: animNode.rotation ? [...animNode.rotation] : undefined,
      scale: animNode.scale ? [...animNode.scale] : undefined,
    };
    baseNodes.push(newNode);
    newlyCreatedNodeIndices.push(newIdx);
    nodeMap.set(animIdx, newIdx);
  }

  // 3. Reconstruct parent-child hierarchy for copied nodes
  for (let animIdx = 0; animIdx < animNodes.length; animIdx += 1) {
    if (dummyMeshNodeIndices.has(animIdx)) continue;
    const animNode = animNodes[animIdx];
    const targetIdx = nodeMap.get(animIdx);
    if (targetIdx !== undefined && animNode.children) {
      const mappedChildren = animNode.children
        .map((c) => nodeMap.get(c))
        .filter((c): c is number => c !== undefined && !dummyMeshNodeIndices.has(c));
      if (mappedChildren.length > 0) {
        baseNodes[targetIdx].children = mappedChildren;
      }
    }
  }

  // 4. Attach only newly created ROOT nodes to baseGltf scene
  const childSet = new Set<number>();
  for (const node of baseNodes) {
    if (node.children) {
      for (const child of node.children) {
        childSet.add(child);
      }
    }
  }

  const activeSceneIndex = baseGltf.scene ?? 0;
  if (baseGltf.scenes?.[activeSceneIndex]) {
    baseGltf.scenes[activeSceneIndex].nodes ??= [];
    const sceneNodes = baseGltf.scenes[activeSceneIndex].nodes!;
    for (const newIdx of newlyCreatedNodeIndices) {
      if (!childSet.has(newIdx) && !sceneNodes.includes(newIdx)) {
        sceneNodes.push(newIdx);
      }
    }
  }

  baseGltf.nodes = baseNodes;
  return nodeMap;
}

/**
 * Merges animation tracks from animGlbBuffer into baseGlbBuffer.
 * Produces a single valid GLB containing both the character mesh and the animation clips.
 */
export function mergeGlbAnimations(
  baseGlbBuffer: ArrayBuffer,
  animGlbBuffer: ArrayBuffer,
): AnimationMergeResult {
  try {
    const parsedA = parseGlbDocument(baseGlbBuffer);
    const parsedB = parseGlbDocument(animGlbBuffer);

    if (!parsedA || !parsedB) {
      return {
        buffer: baseGlbBuffer,
        merged: false,
        animationCount: 0,
        meshCount: 0,
        error: 'Failed to parse one or both GLB containers.',
      };
    }

    const meshesA = parsedA.gltf.meshes?.length ?? 0;
    const meshesB = parsedB.gltf.meshes?.length ?? 0;
    const isClipA = isMotionClipDoc(parsedA.gltf, parsedA.bin.byteLength);
    const isClipB = isMotionClipDoc(parsedB.gltf, parsedB.bin.byteLength);

    // Determine target mesh GLTF and source animation GLTF
    let targetMeshGltf: GltfDocument;
    let targetMeshBin: Uint8Array;
    let sourceAnimGltf: GltfDocument;
    let sourceAnimBin: Uint8Array;

    if (isClipA && !isClipB) {
      // Swapped: Buffer B has the character mesh, Buffer A has the animation
      targetMeshGltf = structuredClone(parsedB.gltf);
      targetMeshBin = parsedB.bin;
      sourceAnimGltf = parsedA.gltf;
      sourceAnimBin = parsedA.bin;
    } else if (isClipB && !isClipA) {
      // Buffer A has the character mesh, Buffer B has the animation
      targetMeshGltf = structuredClone(parsedA.gltf);
      targetMeshBin = parsedA.bin;
      sourceAnimGltf = parsedB.gltf;
      sourceAnimBin = parsedB.bin;
    } else if (meshesA === 0 && meshesB > 0) {
      targetMeshGltf = structuredClone(parsedB.gltf);
      targetMeshBin = parsedB.bin;
      sourceAnimGltf = parsedA.gltf;
      sourceAnimBin = parsedA.bin;
    } else {
      targetMeshGltf = structuredClone(parsedA.gltf);
      targetMeshBin = parsedA.bin;
      sourceAnimGltf = parsedB.gltf;
      sourceAnimBin = parsedB.bin;
    }

    const sourceAnimations = sourceAnimGltf.animations ?? [];
    if (sourceAnimations.length === 0) {
      return {
        buffer: baseGlbBuffer,
        merged: false,
        animationCount: targetMeshGltf.animations?.length ?? 0,
        meshCount: targetMeshGltf.meshes?.length ?? 0,
      };
    }

    // 1. Binary chunk concatenation
    const baseBinLength = targetMeshBin.byteLength;
    const binOffset = align4(baseBinLength);
    const mergedBinLength = align4(binOffset + sourceAnimBin.byteLength);
    const mergedBin = new Uint8Array(mergedBinLength);
    mergedBin.set(targetMeshBin, 0);
    mergedBin.set(sourceAnimBin, binOffset);

    // 2. BufferViews mapping
    targetMeshGltf.bufferViews ??= [];
    const baseBufferViewsCount = targetMeshGltf.bufferViews.length;
    for (const bv of sourceAnimGltf.bufferViews ?? []) {
      targetMeshGltf.bufferViews.push({
        ...bv,
        buffer: 0,
        byteOffset: (bv.byteOffset ?? 0) + binOffset,
      });
    }

    // 3. Accessors mapping
    targetMeshGltf.accessors ??= [];
    const baseAccessorsCount = targetMeshGltf.accessors.length;
    for (const acc of sourceAnimGltf.accessors ?? []) {
      const newAcc: GltfAccessor = { ...acc };
      if (acc.bufferView !== undefined) {
        newAcc.bufferView = baseBufferViewsCount + acc.bufferView;
      }
      if (acc.sparse) {
        newAcc.sparse = {
          ...acc.sparse,
          indices: {
            ...acc.sparse.indices,
            bufferView: baseBufferViewsCount + acc.sparse.indices.bufferView,
          },
          values: {
            ...acc.sparse.values,
            bufferView: baseBufferViewsCount + acc.sparse.values.bufferView,
          },
        };
      }
      targetMeshGltf.accessors.push(newAcc);
    }

    // 4. Node mapping & hierarchy reconstruction
    const nodeMap = buildNodeIndexMap(targetMeshGltf, sourceAnimGltf);

    // 5. Skins mapping
    targetMeshGltf.skins ??= [];
    const baseSkinsCount = targetMeshGltf.skins.length;
    for (const skin of sourceAnimGltf.skins ?? []) {
      const mappedJoints = (skin.joints ?? [])
        .map((j) => nodeMap.get(j))
        .filter((j): j is number => j !== undefined);

      if (mappedJoints.length > 0) {
        // Check if an equivalent skin already exists in target
        const existingSkin = targetMeshGltf.skins.find(
          (s) =>
            (s.name && skin.name && s.name === skin.name) ||
            (s.joints.length === mappedJoints.length && s.joints.every((j, i) => j === mappedJoints[i])),
        );

        if (existingSkin) {
          if (existingSkin.inverseBindMatrices === undefined && skin.inverseBindMatrices !== undefined) {
            existingSkin.inverseBindMatrices = baseAccessorsCount + skin.inverseBindMatrices;
          }
          continue;
        }

        const newSkin: GltfSkin = {
          name: skin.name || 'Armature',
          joints: mappedJoints,
        };
        if (skin.inverseBindMatrices !== undefined) {
          newSkin.inverseBindMatrices = baseAccessorsCount + skin.inverseBindMatrices;
        }
        if (skin.skeleton !== undefined) {
          newSkin.skeleton = nodeMap.get(skin.skeleton);
        }
        targetMeshGltf.skins.push(newSkin);
      }
    }

    // Link skin to mesh node if mesh primitives have JOINTS_0 and WEIGHTS_0
    if (targetMeshGltf.skins.length > baseSkinsCount) {
      const newSkinIndex = baseSkinsCount;
      for (const node of targetMeshGltf.nodes ?? []) {
        if (node.mesh !== undefined && node.skin === undefined) {
          const mesh = targetMeshGltf.meshes?.[node.mesh];
          const hasSkinAttributes = mesh?.primitives?.some(
            (p) => p.attributes?.JOINTS_0 !== undefined && p.attributes?.WEIGHTS_0 !== undefined,
          );
          if (hasSkinAttributes) {
            node.skin = newSkinIndex;
          }
        }
      }
    }

    // 6. Animations mapping
    targetMeshGltf.animations ??= [];
    let addedCount = 0;

    for (const anim of sourceAnimations) {
      // Deduplicate if an identical animation already exists
      const isDupe = targetMeshGltf.animations.some((existing) => isDuplicateAnimation(existing, anim));
      if (isDupe) {
        continue;
      }

      const newSamplers: GltfAnimationSampler[] = (anim.samplers ?? []).map((s) => ({
        ...s,
        input: baseAccessorsCount + s.input,
        output: baseAccessorsCount + s.output,
      }));

      const newChannels: GltfAnimationChannel[] = [];
      for (const channel of anim.channels ?? []) {
        const targetNode = channel.target?.node;
        if (targetNode === undefined) continue;

        const mappedNode = nodeMap.get(targetNode);
        if (mappedNode === undefined) continue;

        newChannels.push({
          sampler: channel.sampler,
          target: {
            ...channel.target,
            node: mappedNode,
          },
        });
      }

      if (newChannels.length > 0) {
        let animName = anim.name || 'Animation';
        const existingNames = new Set(targetMeshGltf.animations.map((a) => a.name));
        let uniqueName = animName;
        let counter = 1;
        while (existingNames.has(uniqueName)) {
          uniqueName = `${animName}_${counter++}`;
        }

        targetMeshGltf.animations.push({
          ...anim,
          name: uniqueName,
          samplers: newSamplers,
          channels: newChannels,
        });
        addedCount += 1;
      }
    }

    if (addedCount === 0) {
      return {
        buffer: baseGlbBuffer,
        merged: false,
        animationCount: targetMeshGltf.animations.length,
        meshCount: targetMeshGltf.meshes?.length ?? 0,
      };
    }

    // 7. Merge extensions
    if (sourceAnimGltf.extensionsUsed) {
      targetMeshGltf.extensionsUsed = Array.from(
        new Set([...(targetMeshGltf.extensionsUsed ?? []), ...sourceAnimGltf.extensionsUsed]),
      );
    }
    if (sourceAnimGltf.extensionsRequired) {
      targetMeshGltf.extensionsRequired = Array.from(
        new Set([...(targetMeshGltf.extensionsRequired ?? []), ...sourceAnimGltf.extensionsRequired]),
      );
    }

    // 8. Update buffers
    targetMeshGltf.buffers = [{ byteLength: mergedBin.byteLength }];

    // 9. Rebuild GLB
    const mergedGlb = buildGlbFromDocument(targetMeshGltf, mergedBin);
    const validation = validateGlb(mergedGlb);

    if (!validation.valid) {
      logger.warn('AnimationMerger', 'Merged GLB failed validation; preserving base model', validation.reason);
      return {
        buffer: baseGlbBuffer,
        merged: false,
        animationCount: targetMeshGltf.animations.length - addedCount,
        meshCount: targetMeshGltf.meshes?.length ?? 0,
        error: validation.reason,
      };
    }

    logger.info('AnimationMerger', `Successfully merged ${addedCount} animation(s) into model GLB (${mergedGlb.byteLength} bytes)`);
    return {
      buffer: mergedGlb,
      merged: true,
      animationCount: validation.metadata?.animationCount ?? targetMeshGltf.animations.length,
      meshCount: validation.metadata?.meshCount ?? (targetMeshGltf.meshes?.length ?? 0),
    };
  } catch (error) {
    logger.warn('AnimationMerger', 'Failed to merge animations into GLB', error);
    return {
      buffer: baseGlbBuffer,
      merged: false,
      animationCount: 0,
      meshCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
