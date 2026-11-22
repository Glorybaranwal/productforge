/**
 * Reads a zip's central directory without unpacking anything, so a .docx can be checked before a
 * parser inflates it (zip bombs, SEC-11). Returns null when the bytes aren't a readable zip.
 */
export type ZipEntry = { name: string; unpackedBytes: number };

export function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const unpackedBytes = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    entries.push({
      name: names.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      unpackedBytes,
    });
    at += 46 + nameLength + extra;
  }
  return entries;
}
