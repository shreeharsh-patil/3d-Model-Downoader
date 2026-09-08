import type {
  Accessor,
  Document,
  GLTF,
  Primitive,
  Transform,
  TypedArray,
} from '@gltf-transform/core';
import { MathUtils } from '@gltf-transform/core';

type DequantizeOptions = {
  pattern?: RegExp;
};

const DEQUANTIZE_DEFAULTS: Required<DequantizeOptions> = {
  pattern: /^((?!JOINTS_).)*$/,
};

function assignDefaults<Defaults extends Record<string, unknown>, Options extends Record<string, unknown>>(
  defaults: Defaults,
  options: Options,
): Defaults & Options {
  const result: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) {
      result[key] = options[key];
    }
  }

  return result as Defaults & Options;
}

function createTransform(name: string, fn: Transform): Transform {
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}

function dequantizeAttributeArray(
  srcArray: TypedArray,
  componentType: GLTF.AccessorComponentType,
  normalized: boolean,
): Float32Array<ArrayBuffer> {
  const dstArray = new Float32Array(srcArray.length);

  for (let index = 0; index < srcArray.length; index += 1) {
    dstArray[index] = normalized
      ? MathUtils.decodeNormalizedInt(srcArray[index], componentType)
      : srcArray[index];
  }

  return dstArray;
}

function dequantizeAttribute(attribute: Accessor): void {
  const srcArray = attribute.getArray();
  if (!srcArray) return;

  attribute
    .setArray(dequantizeAttributeArray(srcArray, attribute.getComponentType(), attribute.getNormalized()))
    .setNormalized(false);
}

function dequantizePrimitive(primitive: Primitive, options: Required<DequantizeOptions>): void {
  for (const semantic of primitive.listSemantics()) {
    if (options.pattern.test(semantic)) {
      dequantizeAttribute(primitive.getAttribute(semantic)!);
    }
  }

  for (const target of primitive.listTargets()) {
    for (const semantic of target.listSemantics()) {
      if (options.pattern.test(semantic)) {
        dequantizeAttribute(target.getAttribute(semantic)!);
      }
    }
  }
}

function documentNeedsQuantization(document: Document): boolean {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const attributeLists = [
        primitive.listSemantics().map((semantic) => [semantic, primitive.getAttribute(semantic)] as const),
        ...primitive.listTargets().map((target) => target.listSemantics().map((semantic) => [semantic, target.getAttribute(semantic)] as const)),
      ];
      for (const attributes of attributeLists) {
        for (const [semantic, accessor] of attributes) {
          if (!accessor || accessor.getComponentType() === 5126) continue;
          if (/^JOINTS_/.test(semantic) && [5121, 5123].includes(accessor.getComponentType())) continue;
          if (/^WEIGHTS_/.test(semantic) && [5121, 5123].includes(accessor.getComponentType()) && accessor.getNormalized()) continue;
          if (/^(TEXCOORD_|COLOR_)/.test(semantic) && [5121, 5123].includes(accessor.getComponentType()) && accessor.getNormalized()) continue;
          return true;
        }
      }
    }
  }
  return false;
}

export function dequantize(options: DequantizeOptions = DEQUANTIZE_DEFAULTS): Transform {
  const resolvedOptions = assignDefaults(DEQUANTIZE_DEFAULTS, options);

  return createTransform('dequantize', (document: Document): void => {
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        dequantizePrimitive(primitive, resolvedOptions);
      }
    }

    if (!documentNeedsQuantization(document)) {
      document.disposeExtension('KHR_mesh_quantization');
    }
  });
}
