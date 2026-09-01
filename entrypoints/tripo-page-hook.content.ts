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
  ],
  runAt: 'document_start',
  world: 'MAIN',
  main: installTripoMainWorldHook,
});
