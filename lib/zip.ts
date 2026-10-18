/**
 * Minimal streaming ZIP writer (STORE, no compression). Photos and videos are already
 * compressed, so deflate would only burn CPU. Each file is read, written, and dropped
 * before the next, so memory stays at one file regardless of how many are selected.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export interface ZipEntry {
  name: string;
  date: Date;
  /** Loaded lazily, one at a time. */
  read: () => Promise<Buffer>;
}

/** Streams a ZIP of `entries`. Entries that fail to load are skipped. */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const central: Buffer[] = [];
  let offset = 0;
  let i = 0;
  let count = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (i < entries.length) {
        const e = entries[i++];
        let data: Buffer;
        try {
          data = await e.read();
        } catch {
          continue;
        }
        const name = Buffer.from(e.name, "utf8");
        const crc = crc32(data);
        const { time, date } = dosTime(e.date);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0x0800, 6); // UTF-8 names
        local.writeUInt16LE(0, 8); // STORE
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);

        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0);
        cen.writeUInt16LE(20, 4);
        cen.writeUInt16LE(20, 6);
        cen.writeUInt16LE(0x0800, 8);
        cen.writeUInt16LE(0, 10);
        cen.writeUInt16LE(time, 12);
        cen.writeUInt16LE(date, 14);
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(data.length, 20);
        cen.writeUInt32LE(data.length, 24);
        cen.writeUInt16LE(name.length, 28);
        cen.writeUInt32LE(offset, 42);
        central.push(cen, name);

        controller.enqueue(new Uint8Array(Buffer.concat([local, name])));
        controller.enqueue(new Uint8Array(data));
        offset += 30 + name.length + data.length;
        count++;
        return; // one file per pull keeps memory flat
      }

      const dir = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(count, 8);
      end.writeUInt16LE(count, 10);
      end.writeUInt32LE(dir.length, 12);
      end.writeUInt32LE(offset, 16);
      controller.enqueue(new Uint8Array(Buffer.concat([dir, end])));
      controller.close();
    },
  });
}
