export function build_stored_zip(files: { name: string; content: string }[]): Uint8Array {
  const local_entries: Buffer[] = [];
  const central_entries: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name_buf = Buffer.from(file.name, 'utf8');
    const content_buf = Buffer.from(file.content, 'utf8');

    const local_header = Buffer.alloc(30);
    local_header.writeUInt32LE(0x04034b50, 0); // local file header signature
    local_header.writeUInt16LE(20, 4); // version needed
    local_header.writeUInt16LE(0, 6); // flags
    local_header.writeUInt16LE(0, 8); // compression method: stored
    local_header.writeUInt16LE(0, 10); // mod time
    local_header.writeUInt16LE(0, 12); // mod date
    local_header.writeUInt32LE(0, 14); // crc32 (unchecked by the reader)
    local_header.writeUInt32LE(content_buf.length, 18); // compressed size
    local_header.writeUInt32LE(content_buf.length, 22); // uncompressed size
    local_header.writeUInt16LE(name_buf.length, 26); // file name length
    local_header.writeUInt16LE(0, 28); // extra field length
    const local_entry = Buffer.concat([local_header, name_buf, content_buf]);
    local_entries.push(local_entry);

    const central_header = Buffer.alloc(46);
    central_header.writeUInt32LE(0x02014b50, 0); // central directory signature
    central_header.writeUInt16LE(20, 4); // version made by
    central_header.writeUInt16LE(20, 6); // version needed
    central_header.writeUInt16LE(0, 8); // flags
    central_header.writeUInt16LE(0, 10); // compression method: stored
    central_header.writeUInt16LE(0, 12); // mod time
    central_header.writeUInt16LE(0, 14); // mod date
    central_header.writeUInt32LE(0, 16); // crc32
    central_header.writeUInt32LE(content_buf.length, 20); // compressed size
    central_header.writeUInt32LE(content_buf.length, 24); // uncompressed size
    central_header.writeUInt16LE(name_buf.length, 28); // file name length
    central_header.writeUInt16LE(0, 30); // extra field length
    central_header.writeUInt16LE(0, 32); // comment length
    central_header.writeUInt16LE(0, 34); // disk number start
    central_header.writeUInt16LE(0, 36); // internal attributes
    central_header.writeUInt32LE(0, 38); // external attributes
    central_header.writeUInt32LE(offset, 42); // offset of local header
    central_entries.push(Buffer.concat([central_header, name_buf]));

    offset += local_entry.length;
  }

  const local_data = Buffer.concat(local_entries);
  const central_data = Buffer.concat(central_entries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(central_data.length, 12); // size of central directory
  eocd.writeUInt32LE(local_data.length, 16); // offset of central directory

  return new Uint8Array(Buffer.concat([local_data, central_data, eocd]));
}
