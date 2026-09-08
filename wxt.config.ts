import { defineConfig } from 'wxt';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  manifestVersion: 3,

  vite: () => ({
    plugins: [
      svelte({
        configFile: false,
        preprocess: vitePreprocess(),
        compilerOptions: {
          fragments: 'tree',
        },
        dynamicCompileOptions() {
          return {
            fragments: 'tree',
          };
        },
      }),
    ],
  }),
  
  manifest: {
    name: 'PolyFetch 3D - Universal Model Downloader',
    short_name: 'PolyFetch 3D',
    description: 'Universal 3D model downloader and multi-format exporter for Meshy, Tripo3D, Luma AI, Rodin, Sketchfab, Poly Pizza, and Poly Haven.',
    action: {
      default_title: 'PolyFetch 3D',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    // permissions rationale:
    // - tabs: inspect active tab URL, track navigation (tabs.onUpdated) to clear stale state, and clean closed tabs (tabs.onRemoved)
    // - storage: store local user preferences and local download history (no credentials stored)
    // - activeTab: temporary active tab interaction when user clicks extension action
    permissions: ['tabs', 'storage', 'activeTab'],
    content_security_policy: {
      // wasm-unsafe-eval is required by Manifest V3 for compiling meshoptimizer WebAssembly decoder
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    host_permissions: [
      'https://studio.tripo3d.ai/*',
      'https://*.meshy.ai/*',
      'https://meshy.ai/*',
      'https://*.tripo3d.ai/*',
      'https://tripo3d.ai/*',
      'https://*.tripo3d.com/*',
      'https://*.data.tripo3d.com/*',
      'https://*.lumalabs.ai/*',
      'https://lumalabs.ai/*',
      'https://*.hyperhuman.top/*',
      'https://*.deemos.com/*',
      'https://*.hyper3d.ai/*',
      'https://*.sketchfab.com/*',
      'https://sketchfab.com/*',
      'https://*.poly.pizza/*',
      'https://poly.pizza/*',
      'https://*.polypizza.net/*',
      'https://*.polyhaven.com/*',
      'https://polyhaven.com/*',
      'https://*.polyhaven.org/*',
      'https://polyhaven.org/*',
      'https://*.cloudfront.net/*',
      'https://*.amazonaws.com/*',
    ],
    browser_specific_settings: {
      gecko: {
        id: '3d-model-downloader@extension',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
