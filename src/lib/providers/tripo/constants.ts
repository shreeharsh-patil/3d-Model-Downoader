export const TRIPO_CONSTANTS = {
  ID: 'tripo' as const,
  LABEL: 'Tripo3D',
  WORKSPACE_URL: 'https://studio.tripo3d.ai/',
  PAGE_PATTERN: /^https:\/\/(?:(?:www|studio)\.)?tripo3d\.ai(\/.*)?$/i,
  DATA_HOSTNAME: 'tripo-data.rg1.data.tripo3d.com',
  STUDIO_PATH_SUBSTRING: '/tripo-studio/',
  PBR_PREFIX: 'tripo_pbr_model_',
  MESHOPT_SUFFIX: '_meshopt.glb',
  MODEL_ID_PATTERN: /model[_-]?([a-zA-Z0-9_-]+)/i,
} as const;
