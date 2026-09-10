/** 浏览器 Preview 与胶囊重放使用相同的不可变字节范围语义。 */
export function snapshotResponse(bytes: Buffer, rangeHeader?: string) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader ?? '');
  let start = 0, end = bytes.length - 1;
  const headers: Record<string, string> = { 'Accept-Ranges': 'bytes' };
  if (range) {
    start = Number(range[1]); end = range[2] ? Number(range[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
      return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': '0' }, body: Buffer.alloc(0) };
    }
    end = Math.min(end, bytes.length - 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return { status: range ? 206 : 200, headers, body: bytes.subarray(start, end + 1) };
}
