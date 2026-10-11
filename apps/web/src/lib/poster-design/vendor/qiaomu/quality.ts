/**
 * Automatic checks that run after the designer lays a cover out: text must stay readable on its background and clear of the
 * parts of a platform's UI that cover the image (avatar, duration badge, stats bar). Pure geometry and colour, no canvas.
 */
export interface Box { x: number; y: number; w: number; h: number }
export interface Zone extends Box { zh: string; en: string }

const hexRgb = (hex: string): [number, number, number] | undefined => {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim()); if (!m) return undefined; let h = m[1]!;
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lum = ([r, g, b]: [number, number, number]): number => {
  const f = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** WCAG contrast ratio (1–21) between two #hex colours; undefined when either is not plain hex. */
export function contrast(a: string, b: string): number | undefined {
  const x = hexRgb(a), y = hexRgb(b); if (!x || !y) return undefined;
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p) as [number, number]; return (hi + 0.05) / (lo + 0.05);
}
/** Whichever of near-black / white reads better on `bg`. */
export function readableOn(bg: string): string { return (contrast('#111111', bg) ?? 21) >= (contrast('#ffffff', bg) ?? 1) ? '#111111' : '#ffffff'; }
/** Keeps `fg` when it already has `min` contrast on `bg`, otherwise returns a readable replacement. */
export function ensureReadable(fg: string, bg: string, min = 3): string {
  const c = contrast(fg, bg); return c === undefined || c >= min ? fg : readableOn(bg);
}
/**
 * The same hue, mixed toward black (or white on a dark ground) in small steps until it reaches `min` contrast on `bg`.
 * For an accent that carries words: the colour stays recognisable instead of being swapped for black or white.
 */
export function toContrast(fg: string, bg: string, min = 3): string {
  const a = hexRgb(fg), b = hexRgb(bg); if (!a || !b || (contrast(fg, bg) ?? 21) >= min) return fg;
  const to = lum(b) > 0.4 ? 0 : 255; let out = fg;
  for (let k = 1; k <= 20; k++) {
    out = '#' + a.map(v => Math.round(v + (to - v) * k * 0.05).toString(16).padStart(2, '0')).join('');
    if ((contrast(out, bg) ?? 0) >= min) break;
  }
  return out;
}
const hit = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/**
 * Where a text box should sit so it clears every avoid zone: the same x, moved up for zones in the lower half and down for
 * zones in the upper half. Undefined when it already clears them or no move would keep it on the canvas.
 */
export function clearOfZones(box: Box, zones: Box[], canvasH: number, pad: number): number | undefined {
  let y = box.y; let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    const blocking = zones.find(z => hit({ ...box, y }, z)); if (!blocking) break;
    const next = blocking.y + blocking.h / 2 > canvasH / 2 ? blocking.y - box.h - pad : blocking.y + blocking.h + pad; y = next; moved = true;
  }
  if (!moved || y < 0 || y + box.h > canvasH) return undefined; return y;
}

/**
 * How big the words are when the cover is a card in a phone feed. Widths are the typical rendered card width in CSS px:
 * a Xiaohongshu two-column card, a YouTube/Bilibili sidebar thumbnail, a WeChat share card.
 */
export const FEED_WIDTH: Record<string, number> = { xhs: 170, 'xhs-square': 170, portrait: 170, square: 170, youtube: 168, bilibili: 170, 'bilibili-43': 170, 'bilibili-hd': 170, wide: 168, vertical: 120, wechat: 150, x: 300 };
export interface ThumbText { role: 'title' | 'subtitle'; size: number; text: string }
export interface ThumbIssue { role: 'title' | 'subtitle'; kind: 'small' | 'long'; px?: number; min?: number }
/** Below these the words blur into a smudge at feed size (glyph height in CSS px). */
export const THUMB_MIN = { title: 11, subtitle: 6 };
/** Problems a cover has at feed size: a headline or subtitle too small to read, or a headline too long to take in at a glance. */
export function thumbCheck(texts: ThumbText[], canvasWidth: number, platformId?: string): ThumbIssue[] {
  const k = (FEED_WIDTH[platformId ?? ''] ?? 150) / canvasWidth; const out: ThumbIssue[] = [];
  for (const t of texts) {
    const px = Math.round(t.size * k * 10) / 10; const min = THUMB_MIN[t.role];
    if (px < min) out.push({ role: t.role, kind: 'small', px, min });
  }
  const title = texts.find(t => t.role === 'title');
  if (title) { const flat = title.text.replace(/\s+/g, ''); const units = /[぀-鿿]/.test(flat) ? [...flat].length : flat.length / 2.2; if (units > 15) out.push({ role: 'title', kind: 'long' }); }
  return out;
}
