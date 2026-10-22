/**
 * Minimal streaming ZIP writer (deflate, data descriptors) — no buffering of whole entries, so a
 * tenant backup of any size streams with constant memory. Plain ZIP (no ZIP64): an archive or entry
 * larger than 4 GiB throws; use the server-level pg_dump backup (deploy/backup) for such databases.
 */
import zlib from 'zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array, prev = 0): number {
  const native = (zlib as unknown as { crc32?: (d: Uint8Array, v?: number) => number }).crc32
  if (typeof native === 'function') return native(buf, prev) >>> 0
  let c = (prev ^ 0xffffffff) >>> 0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const LIMIT = 0xffffffff

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

interface CentralEntry {
  name: Buffer
  crc: number
  compressed: number
  size: number
  offset: number
  time: number
  date: number
}

export interface ZipEntryWriter {
  /** Compress and return the bytes to emit for this chunk. */
  write(data: Uint8Array | string): Promise<Uint8Array[]>
  /** Finish the entry; returns the remaining bytes (compressed tail + data descriptor). */
  end(): Promise<Uint8Array[]>
}

export class ZipWriter {
  private offset = 0
  private entries: CentralEntry[] = []
  private open = false

  private track(chunks: Uint8Array[]): Uint8Array[] {
    for (const c of chunks) this.offset += c.length
    if (this.offset > LIMIT) throw new Error('Backup archive exceeds 4 GiB — use the server-level pg_dump backup')
    return chunks
  }

  /** Start a deflated entry. Returns the local header bytes and a writer for the entry body. */
  startEntry(fileName: string, modified = new Date()): { header: Uint8Array[]; entry: ZipEntryWriter } {
    if (this.open) throw new Error('previous zip entry not finished')
    this.open = true
    const name = Buffer.from(fileName, 'utf8')
    const { time, date } = dosDateTime(modified)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)          // version needed
    header.writeUInt16LE(0x0808, 6)      // bit 3: data descriptor, bit 11: UTF-8 names
    header.writeUInt16LE(8, 8)           // deflate
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    // crc / sizes = 0 (in the data descriptor), name length, extra length
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)
    const offset = this.offset
    const headerChunks = this.track([header, name])

    const deflate = zlib.createDeflateRaw({ level: 6 })
    const pending: Uint8Array[] = []
    deflate.on('data', (c: Buffer) => pending.push(c))
    let crc = 0
    let size = 0
    let compressed = 0
    const drain = () => {
      const out = pending.splice(0, pending.length)
      for (const c of out) compressed += c.length
      return out
    }

    const entry: ZipEntryWriter = {
      write: async (data) => {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        if (buf.length === 0) return []
        crc = crc32(buf, crc)
        size += buf.length
        if (size > LIMIT) throw new Error(`Backup entry ${fileName} exceeds 4 GiB`)
        deflate.write(buf)
        await new Promise<void>((resolve) => deflate.flush(zlib.constants.Z_SYNC_FLUSH, () => resolve()))
        return this.track(drain())
      },
      end: async () => {
        await new Promise<void>((resolve, reject) => {
          deflate.once('end', () => resolve())
          deflate.once('error', reject)
          deflate.end()
        })
        const tail = drain()
        const desc = Buffer.alloc(16)
        desc.writeUInt32LE(0x08074b50, 0)
        desc.writeUInt32LE(crc >>> 0, 4)
        desc.writeUInt32LE(compressed, 8)
        desc.writeUInt32LE(size, 12)
        this.entries.push({ name, crc, compressed, size, offset, time, date })
        this.open = false
        return this.track([...tail, desc])
      },
    }
    return { header: headerChunks, entry }
  }

  /** Convenience: a whole small entry at once. */
  async addFile(fileName: string, data: string | Uint8Array): Promise<Uint8Array[]> {
    const { header, entry } = this.startEntry(fileName)
    return [...header, ...(await entry.write(data)), ...(await entry.end())]
  }

  /** Central directory + end record. */
  finish(): Uint8Array[] {
    const start = this.offset
    const chunks: Uint8Array[] = []
    for (const e of this.entries) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0)
      h.writeUInt16LE(20, 4)        // version made by
      h.writeUInt16LE(20, 6)        // version needed
      h.writeUInt16LE(0x0808, 8)
      h.writeUInt16LE(8, 10)
      h.writeUInt16LE(e.time, 12)
      h.writeUInt16LE(e.date, 14)
      h.writeUInt32LE(e.crc >>> 0, 16)
      h.writeUInt32LE(e.compressed, 20)
      h.writeUInt32LE(e.size, 24)
      h.writeUInt16LE(e.name.length, 28)
      h.writeUInt32LE(e.offset, 42)
      chunks.push(h, e.name)
    }
    this.track(chunks)
    const size = this.offset - start
    if (this.entries.length > 0xffff) throw new Error('Too many zip entries')
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.entries.length, 8)
    end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(size, 12)
    end.writeUInt32LE(start, 16)
    chunks.push(end)
    this.offset += end.length
    return chunks
  }
}
