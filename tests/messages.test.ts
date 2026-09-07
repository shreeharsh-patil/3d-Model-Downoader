import { describe, expect, it } from 'vitest';
import { BRIDGE_SOURCE, isExtensionMessage, isMainWorldMessage } from '../src/lib/messages';

describe('Message Protocol Guards', () => {
  describe('Extension Messages', () => {
    it('accepts valid extension messages', () => {
      expect(isExtensionMessage({ type: 'get-active-tab-state' })).toBe(true);
      expect(isExtensionMessage({ type: 'download-active-tab-mesh' })).toBe(true);
      expect(isExtensionMessage({ type: 'get-settings' })).toBe(true);
      expect(isExtensionMessage({ type: 'set-texture-format', value: 'webp' })).toBe(true);
    });

    it('rejects invalid or malformed messages', () => {
      expect(isExtensionMessage(null)).toBe(false);
      expect(isExtensionMessage(undefined)).toBe(false);
      expect(isExtensionMessage('some-string')).toBe(false);
      expect(isExtensionMessage(12345)).toBe(false);
      expect(isExtensionMessage({})).toBe(false);
      expect(isExtensionMessage({ missingType: true })).toBe(false);
      expect(isExtensionMessage({ type: 123 })).toBe(false);
    });
  });

  describe('Main World Bridge Messages', () => {
    it('accepts valid bridge messages matching BRIDGE_SOURCE', () => {
      expect(isMainWorldMessage({ source: BRIDGE_SOURCE, type: 'installed' })).toBe(true);
      expect(isMainWorldMessage({ source: BRIDGE_SOURCE, type: 'glb-ready', payload: {} })).toBe(true);
    });

    it('rejects messages from other sources or unknown formats', () => {
      expect(isMainWorldMessage({ source: 'random-source', type: 'installed' })).toBe(false);
      expect(isMainWorldMessage({ type: 'installed' })).toBe(false);
      expect(isMainWorldMessage(null)).toBe(false);
      expect(isMainWorldMessage('string-message')).toBe(false);
    });
  });
});
