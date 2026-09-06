export const RODIN_CONSTANTS = {
  ID: 'rodin' as const,
  LABEL: 'Rodin (Hyper3D)',
  WORKSPACE_URL: 'https://hyperhuman.deemos.com/rodin',
  PAGE_PATTERN: /^https:\/\/(?:(?:www|rodin)\.)?(?:hyperhuman\.deemos\.com|hyper3d\.ai|hyperhuman\.top)(\/.*)?$/i,
  MODEL_ID_PATTERN: /(?:task|model|rodin)[_-]?([a-zA-Z0-9_-]+)/i,
} as const;
