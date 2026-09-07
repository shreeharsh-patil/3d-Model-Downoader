import { describe, expect, it } from 'vitest';
import { meshyProvider } from '../src/lib/providers/meshy/meshy-provider';
import { tripoProvider } from '../src/lib/providers/tripo/tripo-provider';

describe('Model Asset Classification', () => {
  describe('Meshy Model Classification', () => {
    it('accepts valid Meshy model URLs', () => {
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/tasks/abc123/model.json')).toBe(true);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/tasks/abc123/mesh.json')).toBe(true);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/tasks/abc123/model.meshy')).toBe(true);
      expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/abc123/model.meshy')).toBe(true);
      expect(meshyProvider.isBinaryAsset('https://assets.meshy.ai/tasks/abc123/model.json')).toBe(false);
    });

    it('identifies Meshy texture URLs', () => {
      expect(meshyProvider.isTexture('https://assets.meshy.ai/tasks/abc123/texture_0.png')).toBe(true);
      expect(meshyProvider.isTexture('https://assets.meshy.ai/tasks/abc123/texture_pbr.png')).toBe(true);
      expect(meshyProvider.isTexture('https://assets.meshy.ai/tasks/abc123/model.json')).toBe(false);
    });

    it('rejects non-model web assets', () => {
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/scripts/main.js')).toBe(false);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/styles/app.css')).toBe(false);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/wasm/decoder.wasm')).toBe(false);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/index.html')).toBe(false);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/logo.png')).toBe(false);
      expect(meshyProvider.isModelAsset('https://assets.meshy.ai/avatar.jpg')).toBe(false);
    });

    it('extracts task ID correctly from URL', () => {
      expect(meshyProvider.extractModelId('https://www.meshy.ai/workspace/text-to-3d/task_12345')).toBe('task_12345');
      expect(meshyProvider.extractModelId('https://www.meshy.ai/workspace/image-to-3d/task_abcde')).toBe('task_abcde');
      expect(meshyProvider.extractModelId('https://www.meshy.ai/workspace/remesh/task_999')).toBe('task_999');
    });
  });

  describe('Tripo3D Model Classification', () => {
    it('accepts valid Tripo meshopt GLB URLs from all CDN regions', () => {
      const legacyUrl =
        'https://tripo-data.rg1.data.tripo3d.com/tripo-studio/task123/tripo_pbr_model_test_meshopt.glb';
      expect(tripoProvider.isModelAsset(legacyUrl)).toBe(true);
      expect(tripoProvider.isBinaryAsset(legacyUrl)).toBe(true);

      const va1Url = 'https://tripo-data.va1.data.tripo3d.com/models/task456/model.glb';
      expect(tripoProvider.isModelAsset(va1Url)).toBe(true);

      const presignedS3 =
        'https://tripo-models.s3.amazonaws.com/task789/tripo_model.glb?X-Amz-Signature=abc123';
      expect(tripoProvider.isModelAsset(presignedS3)).toBe(true);

      const studioApiUrl =
        'https://studio.tripo3d.ai/api/v2/download/model.glb?token=xyz';
      expect(tripoProvider.isModelAsset(studioApiUrl)).toBe(true);
    });

    it('rejects non-model or static web assets', () => {
      expect(tripoProvider.isModelAsset('https://tripo-data.rg1.data.tripo3d.com/tripo-studio/task123/image.png')).toBe(
        false,
      );
      expect(tripoProvider.isModelAsset('https://tripo-data.rg1.data.tripo3d.com/tripo-studio/task123/image.jpg')).toBe(
        false,
      );
      expect(tripoProvider.isModelAsset('https://studio.tripo3d.ai/static/js/bundle.js')).toBe(false);
      expect(tripoProvider.isModelAsset('https://studio.tripo3d.ai/static/css/style.css')).toBe(false);
      expect(tripoProvider.isModelAsset('https://studio.tripo3d.ai/meshopt_decoder.wasm')).toBe(false);
      expect(tripoProvider.isModelAsset('https://studio.tripo3d.ai/index.html')).toBe(false);
      expect(tripoProvider.isModelAsset('https://other-unrelated-domain.com/asset.png')).toBe(false);
    });
  });
});
