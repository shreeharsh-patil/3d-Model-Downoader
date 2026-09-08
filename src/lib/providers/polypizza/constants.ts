export const POLYPIZZA_CONSTANTS = {
  ID: 'polypizza' as const,
  LABEL: 'Poly Pizza',
  WORKSPACE_URL: 'https://poly.pizza',
  PAGE_PATTERN: /^https:\/\/(?:(?:www|static|api)\.)?poly\.pizza(\/.*)?$/i,
  MODEL_ID_PATTERN: /(?:m|bundle|model)\/([a-zA-Z0-9_-]+)/i,
} as const;
