/**
 * Texture and craft primitives for templates: grain, paper, tape, stickers, tickers, soft light, seals. They are plain
 * Fabric objects built synchronously, so a template stays a pure function, every piece stays editable, and a thumbnail
 * renders exactly like the real cover. Nothing here loads files or touches the network.
 */
import { Circle, FabricObject, getEnv, Gradient, Line, Path, Pattern, Polygon, Rect, Shadow, Textbox } from 'fabric';
import { BadgeBox } from './badge';

type Role = FabricObject & { qcRole?: string };
const tag = <T extends FabricObject>(o: T, role: string): T => { (o as Role).qcRole = role; return o; };

/** A tile of film grain as a repeating pattern over the whole artboard. Undefined where no canvas exists (unit tests). */
export function grain(w: number, h: number, opacity = 0.08, seed = 7): Rect | undefined {
  try {
    const doc = getEnv().document; if (!doc) return undefined;
    const cv = doc.createElement('canvas'); cv.width = cv.height = 128; const ctx = cv.getContext('2d'); if (!ctx) return undefined;
    const img = ctx.createImageData(128, 128); let x = seed * 9301 + 49297;
    for (let i = 0; i < img.data.length; i += 4) { x = (x * 9301 + 49297) % 233280; const v = (x / 233280) * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return tag(new Rect({ left: 0, top: 0, width: w, height: h, originX: 'left', originY: 'top', fill: new Pattern({ source: cv, repeat: 'repeat' }), opacity, selectable: true, globalCompositeOperation: 'overlay' }), 'grain');
  } catch { return undefined; }
}

/** A sheet of paper: slightly rotated, with a soft contact shadow. */
export function paper(left: number, top: number, w: number, h: number, fill: string, angle = 0, u = 1, extra: Record<string, unknown> = {}): Rect {
  return tag(new Rect({ left, top, width: w, height: h, fill, angle, originX: 'left', originY: 'top', shadow: new Shadow({ color: 'rgba(40,25,10,0.28)', blur: 22 * u, offsetX: 0, offsetY: 8 * u }), ...extra }), 'paper');
}
/** Translucent masking tape. */
export function tape(left: number, top: number, w: number, h: number, angle: number, fill = 'rgba(255,224,120,0.78)'): Rect { return tag(new Rect({ left, top, width: w, height: h, fill, angle, originX: 'left', originY: 'top', opacity: 0.92 }), 'tape'); }

/** An organic blob (one path, scaled and rotated). */
export function blob(cx: number, cy: number, size: number, fill: string, opacity = 1, angle = 0): Path {
  const p = new Path('M155 38c24 22 38 56 24 86s-52 56-88 50-62-38-60-72 22-58 56-70 44-14 68 6z', { fill, opacity, originX: 'center', originY: 'center', left: cx, top: cy, angle });
  const k = size / 200; p.set({ scaleX: k, scaleY: k }); return p;
}
export function sparkle(cx: number, cy: number, size: number, fill: string, angle = 0): Path {
  const p = new Path('M60 4C64 40 80 56 116 60 80 64 64 80 60 116 56 80 40 64 4 60 40 56 56 40 60 4z', { fill, originX: 'center', originY: 'center', left: cx, top: cy, angle }); const k = size / 120; p.set({ scaleX: k, scaleY: k }); return p;
}
/** A starburst: the classic price-tag shape. */
export function burst(cx: number, cy: number, r: number, fill: string, points = 14, angle = 0): Polygon {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < points * 2; i++) { const rr = i % 2 ? r * 0.66 : r; const a = (i / (points * 2)) * Math.PI * 2; pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr }); }
  return new Polygon(pts, { fill, originX: 'center', originY: 'center', left: cx, top: cy, angle });
}
/** Soft light: a radial gradient that fades to nothing, so there is never a visible edge. */
export function glow(cx: number, cy: number, r: number, color: string, opacity = 0.6): Circle {
  return tag(new Circle({ left: cx - r, top: cy - r, radius: r, originX: 'left', originY: 'top', opacity, fill: new Gradient({ type: 'radial', coords: { x1: r, y1: r, r1: 0, x2: r, y2: r, r2: r }, colorStops: [{ offset: 0, color }, { offset: 0.55, color: `${color}55` }, { offset: 1, color: `${color}00` }] }) }), 'glow');
}
/** A fine rule. */
export function rule(x: number, y: number, len: number, color: string, weight = 2, vertical = false, opacity = 1): Line {
  return new Line(vertical ? [0, 0, 0, len] : [0, 0, len, 0], { left: x, top: y, stroke: color, strokeWidth: weight, opacity, originX: 'left', originY: 'top', strokeLineCap: 'butt' });
}
/** Faded giant lettering behind the content: outline only, or a quiet fill. */
export function ghost(text: string, left: number, top: number, size: number, color: string, opacity = 0.12, outline = false): Textbox {
  return tag(new Textbox(text, { left, top, width: Math.max(size * text.length * 0.8, size), originX: 'left', originY: 'top', fontSize: size, fontWeight: 'bold', lineHeight: 0.9, fill: outline ? 'rgba(0,0,0,0)' : color, stroke: outline ? color : undefined, strokeWidth: outline ? Math.max(2, size * 0.012) : 0, opacity, selectable: true, splitByGrapheme: false }), 'ghost');
}
/** A repeating strip of words on a band, rotated: the "now playing" ticker. */
export function ticker(w: number, y: number, h: number, word: string, size: number, fg: string, bg: string, angle = 0): FabricObject[] {
  const unit = `${word}  ✦  `; const reps = Math.ceil((w * 1.6) / Math.max(size * unit.length * 0.62, 1)) + 1;
  const band = new Rect({ left: -w * 0.1, top: y, width: w * 1.2, height: h, fill: bg, originX: 'left', originY: 'top', angle });
  const text = new Textbox(unit.repeat(reps), { left: -w * 0.08, top: y + (h - size * 1.2) / 2, width: w * 3, fontSize: size, fontWeight: 'bold', fill: fg, originX: 'left', originY: 'top', splitByGrapheme: false, angle, lineHeight: 1.2 });
  const rad = (angle * Math.PI) / 180; const off = { x: -(h - size * 1.2) / 2 * Math.sin(rad), y: ((h - size * 1.2) / 2) * (Math.cos(rad) - 1) }; text.set({ left: (text.left ?? 0) + off.x, top: (text.top ?? 0) + off.y });
  return [tag(band, 'ticker'), tag(text, 'ticker')];
}
/** A round sticker with a word on it. Longer words get smaller, so four characters still sit inside the disc. */
export function stickerDot(cx: number, cy: number, r: number, fill: string, label: string, ink: string, angle = 0, ring?: string): FabricObject[] {
  const dot = new Circle({ left: cx, top: cy, radius: r, fill, stroke: ring, strokeWidth: ring ? r * 0.08 : 0, originX: 'center', originY: 'center', angle, shadow: new Shadow({ color: 'rgba(0,0,0,0.22)', blur: r * 0.3, offsetX: 0, offsetY: r * 0.1 }) });
  const t = new BadgeBox(label, { fontSize: r * Math.min(0.62, 1.5 / Math.max(1, [...label].length * (/[\u3400-\u9fff]/.test(label) ? 1 : 0.6))), fontWeight: 'bold', fill: ink, badgeBg: 'rgba(0,0,0,0)', padX: 0.2, padY: 0.2, originX: 'center', originY: 'center', left: cx, top: cy, angle, qcRole: 'badge' } as ConstructorParameters<typeof BadgeBox>[1]);
  return [dot, t];
}
/** A red seal chop: a rounded square with one character reversed out. */
export function seal(left: number, top: number, size: number, char: string, color = '#c0392b'): FabricObject[] {
  const sq = new Rect({ left, top, width: size, height: size, rx: size * 0.1, ry: size * 0.1, fill: color, originX: 'left', originY: 'top', angle: -3, opacity: 0.92 });
  const t = new BadgeBox(char.slice(0, 2), { fontSize: size * 0.56, fontWeight: 'bold', fill: '#f6efe0', badgeBg: 'rgba(0,0,0,0)', padX: 0.1, padY: 0.1, originX: 'center', originY: 'center', left: left + size / 2, top: top + size / 2, angle: -3, fontFamily: 'serif' } as ConstructorParameters<typeof BadgeBox>[1]);
  return [sq, t];
}

/* ---------- print-poster system: the small marks that make a layout read as designed ---------- */
/** Corner crop marks inside the artboard (two short strokes per corner). */
export function cropMarks(w: number, h: number, inset: number, len: number, color: string, weight = 2): FabricObject[] {
  const L = (x: number, y: number, dx: number, dy: number): Line => new Line([0, 0, dx * len, dy * len], { left: Math.min(x, x + dx * len), top: Math.min(y, y + dy * len), stroke: color, strokeWidth: weight, originX: 'left', originY: 'top' });
  const out: FabricObject[] = [];
  for (const [cx, cy, sx, sy] of [[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]] as const) { out.push(L(cx, cy, sx, 0)); out.push(L(cx, cy, 0, sy)); }
  return out;
}
/** A registration target: ring with a crosshair. */
export function regMark(cx: number, cy: number, r: number, color: string, weight = 2): FabricObject[] {
  return [
    new Circle({ left: cx, top: cy, radius: r, fill: 'rgba(0,0,0,0)', stroke: color, strokeWidth: weight, originX: 'center', originY: 'center' }),
    new Line([0, 0, r * 2.8, 0], { left: cx - r * 1.4, top: cy, stroke: color, strokeWidth: weight, originX: 'left', originY: 'top' }),
    new Line([0, 0, 0, r * 2.8], { left: cx, top: cy - r * 1.4, stroke: color, strokeWidth: weight, originX: 'left', originY: 'top' }),
  ];
}
/** Text that runs along an edge, rotated a quarter turn (up reads bottom-to-top). The box spans x..x+size and y..y+len. */
export function sideText(text: string, x: number, y: number, len: number, size: number, color: string, dir: 'up' | 'down' = 'up', opacity = 1): Textbox {
  const t = new Textbox(text, { left: dir === 'up' ? x : x + size, top: dir === 'up' ? y + len : y, width: len, fontSize: size, fill: color, originX: 'left', originY: 'top', angle: dir === 'up' ? -90 : 90, textAlign: 'center', charSpacing: 320, fontWeight: 'bold', splitByGrapheme: false, lineHeight: 1, opacity });
  return t;
}
/** A small block of tracked-out caption lines, like the credits in a poster's corner. */
export function metaBlock(lines: string[], left: number, top: number, width: number, size: number, color: string, align: 'left' | 'right' = 'left'): Textbox {
  return new Textbox(lines.join('\n'), { left, top, width, fontSize: size, fill: color, originX: 'left', originY: 'top', fontWeight: 'bold', charSpacing: 160, lineHeight: 1.55, textAlign: align, splitByGrapheme: false });
}
/** A barcode-like strip of bars. */
export function barcode(left: number, top: number, w: number, h: number, color: string, seed = 5): FabricObject[] {
  const out: FabricObject[] = []; let x = left; let s = seed * 7919 + 13;
  while (x < left + w) { s = (s * 9301 + 49297) % 233280; const bw = 2 + Math.floor((s / 233280) * 7); if ((s >> 3) % 3) out.push(new Rect({ left: x, top, width: bw, height: h, fill: color, originX: 'left', originY: 'top' })); x += bw + 2 + ((s >> 5) % 4); }
  return out;
}

/* ---------- comic / thumbnail devices ---------- */
/** Alternating rays fanning out from a point, as one path (a sunburst or manga speed lines). */
export function rays(cx: number, cy: number, reach: number, n: number, fill: string, opacity = 0.1, rot = 0): Path {
  let d = ''; for (let i = 0; i < n; i++) { const a0 = rot + (i / n) * Math.PI * 2, a1 = rot + ((i + 0.5) / n) * Math.PI * 2; d += `M${cx} ${cy}L${(cx + Math.cos(a0) * reach).toFixed(1)} ${(cy + Math.sin(a0) * reach).toFixed(1)}L${(cx + Math.cos(a1) * reach).toFixed(1)} ${(cy + Math.sin(a1) * reach).toFixed(1)}Z`; }
  return tag(new Path(d, { fill, opacity, selectable: true }), 'rays');
}
/** A rounded-top window (arch), the shape behind a portrait in editorial layouts. */
export function arch(left: number, top: number, w: number, h: number, fill: string, stroke?: string, strokeWidth = 0): Path {
  const r = w / 2; return new Path(`M0 ${h}L0 ${r}A${r} ${r} 0 0 1 ${w} ${r}L${w} ${h}Z`, { left, top, fill, stroke, strokeWidth, originX: 'left', originY: 'top' });
}
/** A grid of dots, optionally fading toward one corner (halftone). */
export function dotGrid(left: number, top: number, cols: number, rows: number, gap: number, r: number, fill: string, opacity = 0.2, fade = true): Circle[] {
  const out: Circle[] = []; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const k = fade ? 1 - (x / cols + y / rows) / 2.2 : 1; if (k > 0.12) out.push(new Circle({ left: left + x * gap, top: top + y * gap, radius: Math.max(1, r * k), fill, opacity, originX: 'center', originY: 'center' })); }
  return out;
}
/** A comic caption box: white card, thick ink border and a hard shadow. */
export function captionBox(left: number, top: number, w: number, h: number, u: number, fill = '#ffffff', ink = '#111111', angle = 0): Rect {
  return new Rect({ left, top, width: w, height: h, fill, stroke: ink, strokeWidth: Math.max(4, 7 * u), angle, originX: 'left', originY: 'top', shadow: new Shadow({ color: ink, blur: 0, offsetX: 9 * u, offsetY: 9 * u }) });
}
