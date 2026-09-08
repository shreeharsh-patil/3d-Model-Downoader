export const POLYHAVEN_CONSTANTS = {
  ID: 'polyhaven' as const,
  LABEL: 'Poly Haven',
  WORKSPACE_URL: 'https://polyhaven.com/models',
  PAGE_PATTERN: /^https:\/\/(?:(?:www|dl|api)\.)?polyhaven\.(?:com|org)(\/.*)?$/i,
  MODEL_ID_PATTERN: /(?:a|files|models)\/([a-zA-Z0-9_-]+)/i,
} as const;
