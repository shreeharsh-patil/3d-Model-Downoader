// Chrome runtime messages use JSON serialization; ArrayBuffer becomes {}.
export function encodeModelBuffer(buffer: ArrayBuffer): string {
  // Leave room for base64 expansion and response metadata under Chrome's
  // 64 MiB message limit; surface a useful error instead of losing the reply.
  if (buffer.byteLength > 47 * 1024 * 1024) {
    throw new Error('The processed model is too large for extension messaging. Use the website’s native download for this model.');
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

export function decodeModelBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
