export class BinaryFormatError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at 0x${offset.toString(16)}`);
    this.name = 'BinaryFormatError';
  }
}
/** Bounded little-endian cursor. Every read, skip and child range is checked. */
export class BinaryReader {
  constructor(
    readonly buffer: Buffer,
    public offset = 0,
    readonly end = buffer.length,
  ) {
    if (offset < 0 || end > buffer.length || offset > end) this.fail('Invalid reader bounds');
  }
  fail(message: string): never {
    throw new BinaryFormatError(message, this.offset);
  }
  ensure(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.end)
      this.fail(
        `Truncated or invalid binary data: need ${length} bytes, have ${this.end - this.offset}`,
      );
  }
  skip(length: number): void {
    this.ensure(length);
    this.offset += length;
  }
  bytes(length: number): Buffer {
    this.ensure(length);
    const out = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  i32(): number {
    this.ensure(4);
    const n = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return n;
  }
  u32(): number {
    this.ensure(4);
    const n = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return n;
  }
  u16(): number {
    this.ensure(2);
    const n = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return n;
  }
  u8(): number {
    this.ensure(1);
    return this.buffer[this.offset++]!;
  }
  f32(): number {
    this.ensure(4);
    const n = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return n;
  }
  i64(): bigint {
    this.ensure(8);
    const n = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return n;
  }
  position64(): number {
    const n = this.i64();
    if (n < 0 || n > BigInt(Number.MAX_SAFE_INTEGER)) this.fail('Invalid 64-bit position');
    return Number(n);
  }
  count(max = 100_000): number {
    const n = this.i32();
    if (n < 0 || n > max) this.fail(`Invalid element count ${n}`);
    return n;
  }
  fstring(max = 1_048_576): string {
    const length = this.i32();
    if (length === 0) return '';
    if (Math.abs(length) > max) this.fail(`FString exceeds ${max} code units`);
    const wide = length < 0;
    const raw = this.bytes(Math.abs(length) * (wide ? 2 : 1));
    if (raw[raw.length - 1] !== 0 || (wide && raw[raw.length - 2] !== 0))
      this.fail('FString lacks NUL terminator');
    const text = raw.subarray(0, raw.length - (wide ? 2 : 1)).toString(wide ? 'utf16le' : 'utf8');
    if (text.includes('\0')) this.fail('Embedded NUL in FString');
    return text;
  }
  child(length: number): BinaryReader {
    this.ensure(length);
    return new BinaryReader(this.buffer, this.offset, this.offset + length);
  }
}
