import { defineContentScript } from '#imports';
import { installTripoMainWorldHook } from '../src/lib/tripo-main-world-hook';

export default defineContentScript({
  matches: [
    'https://*.tripo3d.ai/*',
    'https://tripo3d.ai/*',
    'https://*.tripo3d.com/*',
    'https://tripo3d.com/*',
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
  ],
  runAt: 'document_start',
  world: 'MAIN',
  main: installTripoMainWorldHook,
});
