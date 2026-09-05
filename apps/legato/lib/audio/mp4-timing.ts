type Box = { type: string; start: number; end: number; payload: number };
export function trimAacPriming(
  buffer: ArrayBuffer,
  delay: number,
  duration: number,
  movieDuration: number,
) {
  const view = new DataView(buffer);
  function boxes(start: number, end: number) {
    const found: Box[] = [];
    while (start + 8 <= end) {
      let size = view.getUint32(start),
        header = 8;
      if (size === 1) {
        size = Number(view.getBigUint64(start + 8));
        header = 16;
      }
      if (size === 0) size = end - start;
      if (!Number.isSafeInteger(size) || size < header || start + size > end)
        throw new Error('视频封装结构异常，无法校准声音时序。');
      const type = String.fromCharCode(...new Uint8Array(buffer, start + 4, 4));
      found.push({ type, start, end: start + size, payload: start + header });
      start += size;
    }
    return found;
  }
  function child(box: Box, type: string) {
    const result = boxes(box.payload, box.end).find((b) => b.type === type);
    if (!result) throw new Error('视频缺少音频时序信息，请尝试 WebM 导出。');
    return result;
  }
  function writeDuration(
    box: Box,
    value: number,
    offset0: number,
    offset1: number,
  ) {
    if (view.getUint8(box.payload) === 1)
      view.setBigUint64(box.payload + offset1, BigInt(Math.round(value)));
    else view.setUint32(box.payload + offset0, Math.round(value));
  }
  const moov = boxes(0, buffer.byteLength).find((b) => b.type === 'moov');
  if (!moov) throw new Error('视频封装不完整。');
  const mvhd = child(moov, 'mvhd');
  const movieScale = view.getUint32(
    mvhd.payload + (view.getUint8(mvhd.payload) === 1 ? 20 : 12),
  );
  let adjusted = false;
  for (const track of boxes(moov.payload, moov.end).filter(
    (b) => b.type === 'trak',
  )) {
    const mdia = child(track, 'mdia'),
      hdlr = child(mdia, 'hdlr');
    const handler = String.fromCharCode(
      ...new Uint8Array(buffer, hdlr.payload + 8, 4),
    );
    if (handler !== 'soun') continue;
    const mdhd = child(mdia, 'mdhd');
    const audioScale = view.getUint32(
      mdhd.payload + (view.getUint8(mdhd.payload) === 1 ? 20 : 12),
    );
    const elst = child(child(track, 'edts'), 'elst');
    if (view.getUint32(elst.payload + 4) !== 2)
      throw new Error('音频时间线格式不支持当前校准。');
    const wide = view.getUint8(elst.payload) === 1;
    const first = elst.payload + 8,
      second = first + (wide ? 20 : 12);
    if (wide) {
      view.setBigUint64(first, BigInt(0));
      view.setBigUint64(second, BigInt(Math.round(duration * movieScale)));
      view.setBigInt64(
        second + 8,
        BigInt(Math.round(Math.max(0, delay) * audioScale)),
      );
    } else {
      view.setUint32(first, 0);
      view.setUint32(second, Math.round(duration * movieScale));
      view.setInt32(second + 4, Math.round(Math.max(0, delay) * audioScale));
    }
    writeDuration(child(track, 'tkhd'), duration * movieScale, 20, 28);
    adjusted = true;
  }
  if (!adjusted) throw new Error('没有找到可校准的音轨。');
  writeDuration(mvhd, movieDuration * movieScale, 16, 24);
  return buffer;
}
