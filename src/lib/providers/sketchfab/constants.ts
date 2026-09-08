export const SKETCHFAB_CONSTANTS = {
  ID: 'sketchfab' as const,
  LABEL: 'Sketchfab',
  WORKSPACE_URL: 'https://sketchfab.com/feed',
  PAGE_PATTERN: /^https:\/\/(?:(?:www|media)\.)?sketchfab\.com(\/.*)?$/i,
  MODEL_ID_PATTERN: /(?:3d-models\/[^\s/]+-([a-f0-9]{32})|models\/([a-f0-9]{32}))/i,
} as const;
