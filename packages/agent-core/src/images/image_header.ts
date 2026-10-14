export type ImageDimensions = { width: number; height: number };

export function sniff_image_mime_type(bytes: Uint8Array): string | undefined {
  if (starts_with(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts_with(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts_with(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (is_webp(bytes)) return 'image/webp';
  return undefined;
}

export function read_image_dimensions(bytes: Uint8Array): ImageDimensions | undefined {
  switch (sniff_image_mime_type(bytes)) {
    case 'image/png':
      return read_png_dimensions(bytes);
    case 'image/jpeg':
      return read_jpeg_dimensions(bytes);
    case 'image/gif':
      return read_gif_dimensions(bytes);
    case 'image/webp':
      return read_webp_dimensions(bytes);
    default:
      return undefined;
  }
}

// PNG: an 8-byte signature, then the IHDR chunk (length + type + payload). Width and
// height are the first two big-endian uint32s of that payload.
function read_png_dimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined;
  if (!matches_at(bytes, 12, [0x49, 0x48, 0x44, 0x52])) return undefined;
  return size_or_undefined(read_uint32_be(bytes, 16), read_uint32_be(bytes, 20));
}

// GIF: a 6-byte signature, then the logical screen width and height as little-endian
// uint16s.
function read_gif_dimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10) return undefined;
  return size_or_undefined(read_uint16_le(bytes, 6), read_uint16_le(bytes, 8));
}

// JPEG: a chain of marker segments. Size lives in the frame header (SOF), which is the
// only marker whose payload starts with precision + height + width. Walk the chain
// rather than guessing an offset, because the segments before it vary by encoder.
function read_jpeg_dimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (is_start_of_frame_marker(marker)) {
      return size_or_undefined(
        read_uint16_be(bytes, offset + 7),
        read_uint16_be(bytes, offset + 5),
      );
    }
    const segment_length = read_uint16_be(bytes, offset + 2);
    if (segment_length < 2) return undefined;
    offset += 2 + segment_length;
  }
  return undefined;
}

// WebP: a RIFF container whose first chunk names the codec. Each codec stores the size
// differently, and the lossy/lossless ones store it minus one.
function read_webp_dimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined;
  if (matches_at(bytes, 12, [0x56, 0x50, 0x38, 0x58])) {
    return size_or_undefined(read_uint24_le(bytes, 24) + 1, read_uint24_le(bytes, 27) + 1);
  }
  if (matches_at(bytes, 12, [0x56, 0x50, 0x38, 0x4c]) && bytes[20] === 0x2f) {
    const packed = read_uint32_le(bytes, 21);
    return size_or_undefined((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1);
  }
  if (
    matches_at(bytes, 12, [0x56, 0x50, 0x38, 0x20]) &&
    matches_at(bytes, 23, [0x9d, 0x01, 0x2a])
  ) {
    return size_or_undefined(
      read_uint16_le(bytes, 26) & 0x3fff,
      read_uint16_le(bytes, 28) & 0x3fff,
    );
  }
  return undefined;
}

function is_start_of_frame_marker(marker: number | undefined): boolean {
  if (marker === undefined) return false;
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function is_webp(bytes: Uint8Array): boolean {
  return (
    starts_with(bytes, [0x52, 0x49, 0x46, 0x46]) && matches_at(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  );
}

function starts_with(bytes: Uint8Array, signature: number[]): boolean {
  return matches_at(bytes, 0, signature);
}

function matches_at(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function size_or_undefined(width: number, height: number): ImageDimensions | undefined {
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

function read_uint16_be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function read_uint16_le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function read_uint24_le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function read_uint32_be(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0))
  );
}

function read_uint32_le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x100 +
    (bytes[offset + 2] ?? 0) * 0x10000 +
    (bytes[offset + 3] ?? 0) * 0x1000000
  );
}
