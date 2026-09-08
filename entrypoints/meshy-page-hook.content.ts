import { defineContentScript } from '#imports';
import { installMeshyMainWorldHook } from '../src/lib/meshy-main-world-hook';

export default defineContentScript({
  matches: ['https://meshy.ai/*', 'https://*.meshy.ai/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main: installMeshyMainWorldHook,
});
