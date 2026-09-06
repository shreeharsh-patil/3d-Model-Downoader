export const LUMA_CONSTANTS = {
  ID: 'luma' as const,
  LABEL: 'Luma AI',
  WORKSPACE_URL: 'https://lumalabs.ai/genie',
  PAGE_PATTERN: /^https:\/\/(?:(?:www|cdn|api)\.)?lumalabs\.ai(\/.*)?$/i,
  MODEL_ID_PATTERN: /(?:genie|item|model|task)[_-]?([a-zA-Z0-9_-]+)/i,
} as const;
