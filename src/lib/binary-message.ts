export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB binary per chunk (~10.6 MiB base64)

export function encodeBufferSlice(buffer: ArrayBuffer, start: number, end: number): string {
  const actualEnd = Math.min(end, buffer.byteLength);
  const actualStart = Math.min(start, actualEnd);
  const length = actualEnd - actualStart;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer, actualStart, length).toString('base64');
  }

  const bytes = new Uint8Array(buffer, actualStart, length);
  let binary = '';
  const chunkSize = 16384;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunkEnd = Math.min(offset + chunkSize, bytes.length);
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, chunkEnd) as unknown as number[]);
  }
  return btoa(binary);
}

// Chrome runtime messages use JSON serialization; ArrayBuffer becomes {}.
export function encodeModelBuffer(buffer: ArrayBuffer): string {
  // Leave room for base64 expansion and response metadata under Chrome's
  // 64 MiB message limit; surface a useful error instead of losing the reply.
  if (buffer.byteLength > 47 * 1024 * 1024) {
    throw new Error('The processed model is too large for extension messaging. Use the website’s native download for this model.');
  }
  return encodeBufferSlice(buffer, 0, buffer.byteLength);
}

export function decodeModelBuffer(encoded: string): ArrayBuffer {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(encoded, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

