export const MESHY_CONSTANTS = {
  ID: 'meshy' as const,
  LABEL: 'Meshy',
  WORKSPACE_URL: 'https://www.meshy.ai/workspace',
  PAGE_PATTERN: /^https:\/\/(?:[a-z0-9-]+\.)*meshy\.ai(\/.*)?$/i,
  MODEL_JSON_PATTERN: /(^|\/)(model|mesh)\.json$/i,
  MODEL_BINARY_PATTERN: /(^|\/)(?:model\.meshy|[^/]+\.glb)$/i,
  TEXTURE_PATTERN: /^texture_[^/]*\.png/i,
  MODEL_ID_URL_PATTERN: /\/workspace\/(?:(?:text|image)-to-3d|remesh)\/([a-zA-Z0-9_-]+)/i,
} as const;
