import { describe, expect, it } from 'vitest';
import {
  DownloaderError,
  getUserErrorMessage,
  InvalidGlbError,
  ModelGeneratingError,
  NoModelSelectedError,
  UnsupportedProviderError,
} from '../src/lib/errors';

describe('Error Handling', () => {
  it('formats user-friendly messages for domain errors', () => {
    const err1 = new UnsupportedProviderError();
    expect(getUserErrorMessage(err1)).toContain('Open a supported 3D model website');

    const err2 = new NoModelSelectedError();
    expect(getUserErrorMessage(err2)).toContain('Select or open a model');

    const err3 = new ModelGeneratingError();
    expect(getUserErrorMessage(err3)).toContain('still generating');

    const err4 = new InvalidGlbError('Bad magic');
    expect(getUserErrorMessage(err4)).toContain('Invalid 3D model data: Bad magic');
  });

  it('handles standard Error and unknown error types gracefully', () => {
    expect(getUserErrorMessage(new Error('Generic failure'))).toBe('Generic failure');
    expect(getUserErrorMessage('String error')).toBe('String error');
    expect(getUserErrorMessage(null)).toBe('An unexpected error occurred.');
    expect(getUserErrorMessage({})).toBe('An unexpected error occurred.');
  });
});
