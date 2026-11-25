/** Which map cells the party has seen (the minimap shows only those, like the original's black overview window). */

/** marks every cell within `r` cells of (cx, cy); returns how many were new */
export function revealCircle(bits: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): number {
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * w + x;
      if (!bits[i]) {
        bits[i] = 1;
        n++;
      }
    }
  return n;
}

/** one bit per cell, base64 (a 128x120 map is 2 KB) */
export function packExplored(bits: Uint8Array): string {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

/** the result may be a few cells longer than the map (whole bytes); index it with y * w + x */
export function unpackExplored(text: string): Uint8Array {
  try {
    const s = atob(text);
    const bits = new Uint8Array(s.length * 8);
    for (let i = 0; i < bits.length; i++) bits[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
    return bits;
  } catch {
    return new Uint8Array(0);
  }
}
