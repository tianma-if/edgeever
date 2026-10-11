import { BadgeBox } from './badge';
import { arch, barcode, blob, burst, cropMarks, dotGrid, glow as kitGlow, grain, metaBlock, paper, rays, regMark, rule, seal, sideText, sparkle, stickerDot, tape, ticker } from './kit';
import { ghost } from './kit';
import { Circle, FabricObject, getEnv, Gradient, Line, Polygon, Rect, Shadow, Textbox, TextboxProps, Triangle } from 'fabric';
import { Background } from './model';
import { GAODING } from './gaoding';
import { toContrast } from './quality';

/** Colours a template reads. An assistant (or the user) can override any of them without touching layout. */
export interface Palette { bg: string; bg2: string; ink: string; sub: string; accent: string; accentInk: string }
export interface Slot { x: number; y: number; w: number; h: number; radius: number }
export interface TemplateInput { width: number; height: number; title: string; subtitle: string; zh: boolean; badge?: string; points?: string[]; palette?: Partial<Palette> }
export interface TemplateResult { background: Background; objects: FabricObject[] }
export interface Template {
  id: string; zh: string; en: string;
  /** Platform ids this layout was designed for. They sort first and get a "recommended" mark. */
  fit: string[];
  /** One line on when to pick it. Also shown to the assistant. */
  zhUse: string; enUse: string;
  /** The layout draws its own dark overlay, so a full-bleed picture can sit behind it. */
  photo?: boolean;
  /** Region reserved for a picture (a face, a product shot). Undefined when the layout has none at this size. */
  slot?(i: TemplateInput): Slot | undefined;
  build(i: TemplateInput): TemplateResult;
}
const XHS = ['xhs', 'xhs-square', 'portrait', 'square']; const VIDEO = ['youtube', 'bilibili', 'bilibili-43', 'bilibili-hd', 'wide']; const SHORT = ['vertical']; const BANNER = ['wechat', 'x'];

import { titleFace, typeFor } from './typeset';
const SANS = 'sans-serif';
const SERIF = 'serif';

interface TextOptions { qcRole?: string; fontSize: number; fill: string; fontWeight?: string; fontFamily?: string; lineHeight?: number; textAlign?: string; charSpacing?: number; stroke?: string; strokeWidth?: number; textBackgroundColor?: string; shadow?: Shadow; angle?: number; opacity?: number; fontStyle?: string }

/**
 * Textbox placed by its top-left corner. Any CJK text is wrapped here rather than by Fabric: Fabric's grapheme wrap splits Latin
 * words ("A|I"), starts the next line with the space it broke at, and happily leaves one character alone on the last line.
 */
export function textbox(text: string, left: number, top: number, width: number, o: TextOptions): Textbox {
  const own = hasCjk(text) && !!o.fontSize;
  // Big CJK headlines end up at -18 tracking (see the finish pass below), so wrap them at that tracking.
  const track = o.qcRole === 'title' && o.fontSize >= 64 ? -18 : o.charSpacing ?? 0;
  const lines = own ? wrapLines(text, width, o.fontSize, o.fontWeight ?? 'normal', track) : undefined; const wrapped = !!lines && (lines.length > 1 || /\s/.test(text));
  // Spaces inside a computed line become no-break spaces, so Fabric cannot break the line a second time with its own metrics.
  const box = new Textbox(wrapped ? lines.map(glue).join('\n') : text, {
    left, top, width, originX: 'left', originY: 'top', fontFamily: SANS, fontWeight: 'normal', lineHeight: 1.25, splitByGrapheme: hasCjk(text) && !wrapped, paintFirst: o.stroke ? 'stroke' : 'fill', ...o,
    // The paired face goes in at construction: a Textbox only ever grows to fit, so a first layout in the wider fallback face would stick.
    ...typeFor(o.qcRole, o.fontFamily ?? SANS, o.fontWeight), ...(own ? { charSpacing: track } : {}),
  } as Partial<TextboxProps>);
  // qcSource keeps the writer's own text (with their line breaks) so a re-layout starts from it, not from our wrapping.
  if (wrapped) Object.assign(box, { qcWrapped: true, qcSource: text });
  return box;
}
type Wrapped = Textbox & { qcWrapped?: boolean; qcSource?: string };
const glue = (line: string): string => line.replace(/ /g, '\u00a0');
/** The text as the writer typed it: their own line breaks survive, the breaks we inserted do not. */
export function sourceOf(t: Textbox): string {
  const q = t as Wrapped; if (!q.qcWrapped) return t.text;
  return q.qcSource && unwrap(q.qcSource) === unwrap(t.text) ? q.qcSource : unwrap(t.text);
}
/** Wraps a text we wrapped before again, at its current width, size and real face (after a font loads or the box is resized). */
export function rewrap(t: Textbox): void {
  const q = t as Wrapped; if (!q.qcWrapped || !t.fontSize) return;
  const src = sourceOf(t); const lines = wrapLines(src, t.width, t.fontSize, String(t.fontWeight), t.charSpacing ?? 0, t.fontFamily);
  const next = lines.map(glue).join('\n'); if (next !== t.text) t.set({ text: next }); q.qcSource = src; t.initDimensions();
}
/** Undoes the hard line breaks `textbox` inserted, so a title can be re-laid-out at another width. */
export function unwrap(text: string): string { return text.replace(/\u00a0/g, ' ').replace(/([A-Za-z0-9])\n([A-Za-z0-9])/g, '$1 $2').replace(/\n/g, ''); }

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Rendered width of a single line of text, in px. */
export function textWidth(text: string, size: number, weight = 'bold'): number { return measure(text, size, weight); }
/** Real rendered width when a canvas exists (the app), a close estimate otherwise (unit tests). Measures in the paired title face unless a family is given. */
function measure(text: string, size: number, weight: string, family?: string): number {
  try {
    if (measureCtx === undefined) measureCtx = getEnv().document?.createElement('canvas').getContext('2d') ?? null;
    if (measureCtx) { measureCtx.font = `${weight} ${size}px ${family ? `"${family}"` : titleFace()}, ${SANS}`; return measureCtx.measureText(text).width; }
  } catch { measureCtx = null; }
  let w = 0; for (const ch of text) w += hasCjk(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.56; return w;
}
const CLOSING = /^[，。、！？；：）”’》】…,.!?;:)]$/;
/** Greedy wrap that never splits a Latin word, never starts a line with closing punctuation and never strands one CJK character. */
export function wrapLines(text: string, width: number, size: number, weight = 'bold', spacing = 0, family?: string): string[] {
  const out: string[] = []; const track = size * spacing / 1000;
  const fits = (s: string): boolean => measure(s, size, weight, family) + [...s].length * track <= width;
  for (const para of text.split('\n')) {
    const tokens = para.match(/[A-Za-z0-9][A-Za-z0-9.'’_+%$@#-]*|\s+|[\s\S]/gu) ?? []; let cur = ''; const start = out.length;
    for (const tok of tokens) {
      if (!cur) { if (tok.trim()) cur = tok; continue; }
      if (fits((cur + tok).trimEnd()) || CLOSING.test(tok)) cur += tok;
      else { out.push(cur.trimEnd()); cur = tok.trim() ? tok : ''; }
    }
    if (cur || out.length === start) out.push(cur.trimEnd());
    // A lone CJK character on the last line reads as a mistake: borrow the previous line's last character.
    const n = out.length;
    if (n - start >= 2 && /^[^\sA-Za-z0-9]$/u.test(out[n - 1]!) && hasCjk(out[n - 1]!)) {
      const prev = [...out[n - 2]!]; let take = 1; if (prev.length > 1 && CLOSING.test(prev[prev.length - 1]!)) take = 2;
      if (prev.length - take >= 2 && hasCjk(prev.slice(-take).join(''))) { out[n - 2] = prev.slice(0, -take).join('').trimEnd(); out[n - 1] = prev.slice(-take).join('') + out[n - 1]; }
    }
  }
  return out;
}
export function hasCjk(text: string): boolean { return /[぀-ヿ㐀-鿿豈-﫿＀-￯]/.test(text); }
function rect(left: number, top: number, width: number, height: number, fill: string | Gradient<'linear'> | Gradient<'radial'>, extra: Record<string, unknown> = {}): Rect {
  return new Rect({ left, top, width, height, fill, originX: 'left', originY: 'top', ...extra });
}
function gradient(w: number, h: number, from: string, to: string, angle = 180): Gradient<'linear'> {
  const rad = (angle - 90) * Math.PI / 180; const dx = Math.cos(rad), dy = Math.sin(rad);
  const half = Math.abs(w * dx) / 2 + Math.abs(h * dy) / 2;
  return new Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: w / 2 - dx * half, y1: h / 2 - dy * half, x2: w / 2 + dx * half, y2: h / 2 + dy * half }, colorStops: [{ offset: 0, color: from }, { offset: 1, color: to }] });
}
export { gradient };

const HEX = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
/** Merges a template's own colours with valid overrides. Anything that is not a hex colour is ignored. */
let lastPalette: Palette | undefined;
/** The palette the most recent build resolved to; lets decoration pieces share the template's colours. */
export const builtPalette = (): Palette | undefined => lastPalette;
export function palette(i: TemplateInput, base: Palette): Palette {
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof Palette)[]) { const v = i.palette?.[key]; if (typeof v === 'string' && HEX.test(v)) out[key] = v; }
  if (i.palette?.bg && !i.palette.bg2 && HEX.test(i.palette.bg)) out.bg2 = i.palette.bg;
  lastPalette = out; return out;
}
const solid = (c: string): Background => ({ kind: 'solid', color: c });
const linear = (p: Palette, angle: number): Background => p.bg === p.bg2 ? solid(p.bg) : { kind: 'linear', from: p.bg, to: p.bg2, angle };

/** Sizes follow the shorter side so one layout works on 3:4, 16:9 and 5:2. */
function metrics(i: TemplateInput): { u: number; m: number; wide: boolean; tall: boolean; w: number; h: number } {
  const w = i.width, h = i.height; const u = Math.min(w, h * 1.15) / 1000;
  return { u, m: Math.round(Math.min(w, h) * 0.08), wide: w / h > 1.45, tall: h / w > 1.2, w, h };
}
/** Wrapped line count at a font size. CJK glyphs are square, Latin averages about 0.55 em. */
export function lineCount(text: string, width: number, size: number): number { return wrapLines(text, width, size).length; }
/** Fabric multiplies every line by an extra 1.13 on top of `lineHeight`. */
const FABRIC_LINE = 1.13;
/** Rendered height of wrapped text. */
export function textHeight(text: string, width: number, size: number, lineHeight = 1.2): number { return lineCount(text, width, size) * size * lineHeight * FABRIC_LINE; }
/** Largest font size whose wrapped title still fits the box. Short titles prefer two lines or fewer, and no size leaves an orphan. */
export function fitTitle(text: string, width: number, maxHeight: number, max: number, min = 36, lineHeight = 1.2): number {
  // Scale is what makes a cover feel designed: a very short headline is allowed to grow until the box stops it.
  const units = [...text.replace(/\s+/g, '')].length * (hasCjk(text) ? 1 : 0.55);
  max *= (units <= 3 ? 2.1 : units <= 5 ? 1.75 : units <= 8 ? 1.3 : 1) * 1.15;
  const scan = (lineCap: number, floor: number): number | undefined => {
    for (let size = max; size >= floor; size -= 4) {
      const lines = wrapLines(text, width, size);
      if (lines.length <= lineCap && lines.length * size * lineHeight * FABRIC_LINE <= maxHeight && !orphaned(lines) && lines.every(l => measure(l, size, 'bold') <= width + 1)) return size;
    }
    return undefined;
  };
  // Lines the writer broke themselves are kept one per line: their break is the design, so shrink before wrapping again.
  const paras = text.split('\n').length;
  if (paras > 1 && paras <= 4) return scan(paras, min + 1) ?? scan(99, min + 1) ?? min;
  return (units <= 16 ? scan(2, Math.max(min, max * 0.5)) : undefined) ?? scan(99, min + 1) ?? min;
}
/** True when the last line is a lone character (CJK) or a very short word, which reads as a mistake. */
export function orphaned(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines.some(line => { const t = line.replace(/\s/g, ''); return [...t].length < (hasCjk(t) ? 2 : 3); });
}
const upper = (s: string): string => hasCjk(s) ? s : s.toUpperCase();

/** A small filled pill with the word exactly centred in it (see badge.ts). Returns nothing when there is no text. */
function pill(text: string, left: number, top: number, fill: string, ink: string, size: number, extra: Record<string, unknown> = {}): BadgeBox {
  return new BadgeBox(text.trim(), { left, top, originX: 'left', originY: 'top', fontSize: size, fill: ink, badgeBg: fill, fontFamily: SANS, fontWeight: 'bold', ...typeFor(String(extra.qcRole ?? 'badge'), SANS, extra.fontWeight === undefined ? 'bold' : String(extra.fontWeight)), ...extra } as ConstructorParameters<typeof BadgeBox>[1]);
}
function badge(text: string | undefined, left: number, top: number, p: Palette, size: number, extra: Record<string, unknown> = {}): BadgeBox[] {
  const t = text?.trim(); if (!t) return [];
  const b = pill(t, left, top, p.accent, p.accentInk, Math.round(size * 1.3), { qcRole: 'badge', ...extra }); return [b];
}
/** A glow that fades to nothing at its rim; a flat translucent disc shows a hard edge and looks cheap. */
function softGlow(left: number, top: number, radius: number, color: string, opacity: number): Circle {
  return new Circle({ left, top, radius, originX: 'left', originY: 'top', opacity, fill: new Gradient({ type: 'radial', coords: { x1: radius, y1: radius, r1: 0, x2: radius, y2: radius, r2: radius }, colorStops: [{ offset: 0, color }, { offset: 0.5, color: `${color}55` }, { offset: 1, color: `${color}00` }] }) });
}
const shadowSoft = (u: number): Shadow => new Shadow({ color: 'rgba(0,0,0,0.25)', blur: 18 * u, offsetX: 0, offsetY: 6 * u });
const shadowHard = (u: number, c = '#000000', d = 8): Shadow => new Shadow({ color: c, blur: 0, offsetX: d * u, offsetY: d * u });

export const TEMPLATES: Template[] = [
  {
    id: 'minimal', zh: '简约白', en: 'Minimal', fit: [...XHS, ...BANNER], zhUse: '干净克制，适合观点、读书、知识类', enUse: 'Clean and restrained; opinions, reading, knowledge',
    build(i) {
      const p = palette(i, { bg: '#ffffff', bg2: '#ffffff', ink: '#171717', sub: '#737373', accent: '#171717', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2; const titleH = h * (wide ? 0.55 : 0.5);
      const size = fitTitle(i.title, inner, titleH, 130 * u * (wide ? 1.1 : 1));
      return { background: solid(p.bg), objects: [
        rect(m, m, Math.min(inner, 180 * u), Math.max(4, 8 * u), p.accent),
        ...badge(i.badge, m, m + 26 * u, p, Math.max(20, 28 * u)),
        textbox(i.title, m, h * 0.3, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.18 }),
        textbox(i.subtitle, m, h - m - 90 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 34 * u), fill: p.sub }),
      ] };
    },
  },
  {
    id: 'editorial', zh: '杂志', en: 'Editorial', fit: [...BANNER, ...XHS], zhUse: '衬线大标题 + 细线，有质感，适合深度内容与公众号', enUse: 'Serif headline with rules; essays and articles',
    build(i) {
      const p = palette(i, { bg: '#f4efe4', bg2: '#f4efe4', ink: '#171717', sub: '#404040', accent: '#171717', accentInk: '#f4efe4' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.5, 124 * u);
      return { background: solid(p.bg), objects: [
        rect(m, m, inner, Math.max(3, 4 * u), p.ink),
        textbox(i.badge?.trim() ? upper(i.badge.trim()) : 'COVER STORY', m, m + 26 * u, inner, { qcRole: 'badge', fontSize: Math.max(18, 24 * u), fill: p.ink, charSpacing: 300, fontWeight: 'bold' }),
        textbox(i.title, m, h * 0.3, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.16 }),
        rect(m, h - m - 110 * u, inner, Math.max(2, 3 * u), p.ink),
        textbox(i.subtitle, m, h - m - 84 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 32 * u), fill: p.sub, fontFamily: SERIF }),
      ] };
    },
  },
  {
    id: 'bold', zh: '醒目黄', en: 'Loud yellow', fit: [...XHS, ...VIDEO, ...SHORT], zhUse: '高饱和纯色 + 黑字，信息流里最抢眼', enUse: 'Saturated flat colour with black type; stops the scroll',
    build(i) {
      const p = palette(i, { bg: '#ffe04b', bg2: '#ffe04b', ink: '#111111', sub: '#111111', accent: '#111111', accentInk: '#ffe04b' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.55, 170 * u, 40, 1.1);
      return { background: solid(p.bg), objects: [
        ...badge(i.badge, m, m, p, Math.max(22, 32 * u)),
        textbox(i.title, m, h * 0.2, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.1 }),
        rect(m, h - m - 150 * u, Math.min(inner, 260 * u), Math.max(8, 18 * u), p.accent),
        textbox(i.subtitle, m, h - m - 110 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(26, 38 * u), fill: p.sub, fontWeight: 'bold' }),
      ] };
    },
  },
  {
    id: 'dark', zh: '深色科技', en: 'Dark tech', fit: [...VIDEO, ...BANNER, ...XHS], zhUse: '深底荧光点缀，适合 AI、编程、效率工具', enUse: 'Dark with a neon glow; AI, code, tools',
    build(i) {
      const p = palette(i, { bg: '#0a0a0a', bg2: '#1c1c22', ink: '#fafafa', sub: '#a1a1aa', accent: '#5eead4', accentInk: '#0a0a0a' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.5, 128 * u);
      const glow = softGlow(w * 0.5, -h * 0.35, Math.max(w, h) * 0.42, p.accent, 0.5);
      return { background: linear(p, 160), objects: [
        glow, ...badge(i.badge ?? (i.zh ? '干货' : 'GUIDE'), m, m, p, Math.max(22, 30 * u)),
        textbox(i.title, m, h * 0.28, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15 }),
        textbox(i.subtitle, m, h - m - 90 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 34 * u), fill: p.sub }),
      ] };
    },
  },
  {
    id: 'poster', zh: '大字报', en: 'Poster', fit: [...XHS, ...SHORT], zhUse: '满屏居中大字，情绪强，适合金句、避坑、警告', enUse: 'Full-bleed centred type; punchy statements',
    build(i) {
      const p = palette(i, { bg: '#e11d2e', bg2: '#e11d2e', ink: '#ffffff', sub: '#ffe4e6', accent: '#ffe04b', accentInk: '#111111' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.7, 210 * u, 40, 1.05);
      return { background: solid(p.bg), objects: [
        ...badge(i.badge, m, m, p, Math.max(22, 32 * u)),
        textbox(i.title, m, h * 0.5 - textHeight(i.title, inner, size, 1.05) / 2, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.05, textAlign: 'center' }),
        textbox(i.subtitle, m, h - m - 70 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 32 * u), fill: p.sub, textAlign: 'center' }),
      ] };
    },
  },
  {
    id: 'split', zh: '左文右图', en: 'Split', fit: [...VIDEO, ...BANNER], zhUse: '左文案右主体，右侧可放人像或产品图', enUse: 'Copy left, subject right; leaves room for a portrait or product',
    slot: i => { const { w, h } = metrics(i); const x = w * 0.54; return { x, y: 0, w: w - x, h, radius: 0 }; },
    build(i) {
      const p = palette(i, { bg: '#fff7ed', bg2: '#fff7ed', ink: '#1c1917', sub: '#57534e', accent: '#f97316', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const left = w * 0.54; const inner = left - m * 1.6;
      const size = fitTitle(i.title, inner, h * 0.6, 120 * u * 1.15);
      const panel = rect(left, 0, w - left, h, p.accent);
      const circle = new Circle({ left: left + (w - left) * 0.18, top: h * 0.2, radius: Math.min(w - left, h) * 0.33, fill: p.bg, originX: 'left', originY: 'top' });
      return { background: solid(p.bg), objects: [
        panel, circle, ...badge(i.badge, m, m, p, Math.max(20, 28 * u)),
        textbox(i.title, m, h * 0.2, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15 }),
        textbox(i.subtitle, m, h - m - 80 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(22, 30 * u), fill: p.sub }),
      ] };
    },
  },
  {
    id: 'sticker', zh: '便签', en: 'Sticky note', fit: XHS, zhUse: '粉底便签纸，生活感，适合种草、日常、分享', enUse: 'Pink backdrop, paper note; lifestyle posts',
    build(i) {
      const p = palette(i, { bg: '#fda4af', bg2: '#fda4af', ink: '#292524', sub: '#78716c', accent: '#fcd34d', accentInk: '#292524' });
      const { u, m, w, h } = metrics(i); const pad = m * 1.4; const cardW = w - m * 2; const cardH = h - m * 2;
      const size = fitTitle(i.title, cardW - pad * 2, cardH * 0.5, 120 * u);
      const card = rect(m, m, cardW, cardH, '#fffbea', { rx: 24 * u, ry: 24 * u, shadow: new Shadow({ color: 'rgba(0,0,0,0.18)', blur: 30 * u, offsetX: 0, offsetY: 14 * u }) });
      const tape = rect(w / 2 - 90 * u, m - 18 * u, 180 * u, 44 * u, p.accent, { opacity: 0.85 });
      return { background: solid(p.bg), objects: [
        card, tape, ...badge(i.badge, m + pad, m + pad * 0.7, p, Math.max(20, 28 * u)),
        textbox(i.title, m + pad, m + cardH * 0.22, cardW - pad * 2, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.18 }),
        textbox(i.subtitle, m + pad, m + cardH - pad - 60 * u, cardW - pad * 2, { qcRole: 'subtitle', fontSize: Math.max(22, 30 * u), fill: p.sub }),
      ] };
    },
  },
  {
    id: 'gradient', zh: '渐变光感', en: 'Soft gradient', fit: [...VIDEO, ...BANNER, ...XHS], zhUse: '蓝青渐变 + 白字，通用、稳、不出错', enUse: 'Blue-cyan gradient with white type; safe and versatile',
    build(i) {
      const p = palette(i, { bg: '#2563eb', bg2: '#06b6d4', ink: '#ffffff', sub: '#e0f2fe', accent: '#ffffff', accentInk: '#1d4ed8' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.5, 128 * u);
      const tri = new Triangle({ left: w * 0.62, top: h * 0.08, width: w * 0.5, height: w * 0.5, fill: '#ffffff', opacity: 0.12, angle: 18, originX: 'left', originY: 'top' });
      return { background: linear(p, 135), objects: [
        tri, ...badge(i.badge, m, m, p, Math.max(20, 28 * u)),
        textbox(i.title, m, h * 0.3, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15, shadow: shadowSoft(u) }),
        textbox(i.subtitle, m, h - m - 84 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 34 * u), fill: p.sub }),
      ] };
    },
  },
  {
    id: 'center', zh: '居中标签', en: 'Centered', fit: [...XHS, ...VIDEO], zhUse: '细框居中，黄色高亮副标，通用百搭', enUse: 'Thin frame, centred, highlighted subtitle; all-purpose',
    build(i) {
      const p = palette(i, { bg: '#fafafa', bg2: '#fafafa', ink: '#171717', sub: '#262626', accent: '#ffe04b', accentInk: '#171717' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 3.2;
      const size = fitTitle(i.title, inner, h * 0.5, 120 * u);
      const th = textHeight(i.title, inner, size, 1.2);
      return { background: solid(p.bg), objects: [
        rect(m * 0.6, m * 0.6, w - m * 1.2, h - m * 1.2, 'rgba(0,0,0,0)', { stroke: p.ink, strokeWidth: Math.max(3, 5 * u) }),
        ...badge(i.badge, 0, m * 1.1, p, Math.max(20, 28 * u)).map(b => { b.set({ left: w / 2 - b.width / 2 }); return b; }),
        textbox(i.title, m * 1.6, h * 0.5 - th / 2 - 20 * u, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.2, textAlign: 'center' }),
        ...(i.subtitle.trim() ? [pill(i.subtitle, 0, Math.min(h - m * 2, h * 0.5 + th / 2 + 40 * u), p.accent, p.sub, Math.max(24, 32 * u), { qcRole: 'subtitle', fontWeight: 'normal' })].map(b => { b.set({ left: w / 2 - b.width / 2 }); return b; }) : []),
      ] };
    },
  },
  {
    id: 'checklist', zh: '清单笔记', en: 'Checklist', fit: [...XHS], zhUse: '标题 + 3~4 条要点，信息密度高，小红书干货首选', enUse: 'Headline plus 3–4 points; dense and useful',
    build(i) {
      const p = palette(i, { bg: '#ecfdf3', bg2: '#ecfdf3', ink: '#052e16', sub: '#166534', accent: '#16a34a', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.3, 104 * u);
      const listTop = Math.max(h * 0.4, m + 50 * u + textHeight(i.title, inner, size, 1.15) + 56 * u);
      const rows = (i.points?.length ? i.points : i.subtitle.split(/[\n,，、；;]/)).map(s => s.trim()).filter(Boolean).slice(0, 4);
      const items = (rows.length > 1 ? rows : ['01', '02', '03']).map((label, index) => textbox(rows.length > 1 ? `${index + 1}  ${label}` : `${label}  ${i.zh ? '要点' : 'Point'}`, m, listTop + index * 132 * u, inner, { fontSize: Math.max(30, 60 * u), fill: p.ink, fontWeight: 'bold' }));
      return { background: solid(p.bg), objects: [
        rect(m, m, 120 * u, Math.max(6, 12 * u), p.accent),
        ...badge(i.badge, m + 150 * u, m - 12 * u, p, Math.max(20, 28 * u)),
        textbox(i.title, m, m + 50 * u, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15 }),
        ...items,
      ] };
    },
  },
  {
    id: 'number', zh: '数字干货', en: 'Big number', fit: [...XHS, ...SHORT, 'youtube', 'bilibili', 'bilibili-43'], zhUse: '超大数字做钩子（7 个技巧 / 3 步），点击率高的榜单体', enUse: 'A huge numeral as the hook; listicles',
    slot: i => { const { w, h, wide } = metrics(i); return wide ? undefined : { x: 0, y: h * 0.68, w, h: h * 0.32, radius: 0 }; },
    build(i) {
      const p = palette(i, { bg: '#fff7e6', bg2: '#fff7e6', ink: '#1a1a1a', sub: '#6b6b6b', accent: '#ef4444', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const num = /^[\d.+%×x-]{1,4}$/i.test(i.badge?.trim() ?? '') ? i.badge!.trim() : digits(i); // the hook is a numeral; a word like "实测" would overflow it
      const cw = hasCjk(num) ? 1.05 : 0.64; const numSize = Math.round(wide ? Math.min(h * 0.66, (w * 0.32) / ([...num].length * cw)) : Math.min(h * 0.25, (w - m * 2) / ([...num].length * cw)));
      if (wide) {
        const left = m + w * 0.38; const inner = w - left - m; const size = fitTitle(i.title, inner, h * 0.5, 132 * u); const th = textHeight(i.title, inner, size, 1.15);
        const subS = Math.max(22, size * 0.32); const subH = i.subtitle.trim() ? textHeight(i.subtitle, inner, subS, 1.25) + 24 * u : 0; const ty = (h - th - subH) / 2;
        return { background: solid(p.bg), objects: [
          textbox(num, m, h / 2 - numSize * 0.6, w * 0.36, { qcRole: 'badge', fontSize: numSize, fill: p.accent, fontWeight: 'bold', lineHeight: 1.05 }),
          rect(left - m * 0.6, h * 0.22, Math.max(4, 8 * u), h * 0.56, p.ink),
          textbox(i.title, left, ty, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15 }),
          ...sub(i, left, ty + th + 24 * u, inner, subS, p.sub),
        ] };
      }
      const inner = w - m * 2; const titleTop = m * 0.6 + numSize * 1.05 * 1.13 + 34 * u; const size = fitTitle(i.title, inner, Math.max(h * 0.12, h * 0.6 - titleTop), 150 * u, 32);
      return { background: solid(p.bg), objects: [
        textbox(num, m, m * 0.6, inner, { qcRole: 'badge', fontSize: numSize, fill: p.accent, fontWeight: 'bold', lineHeight: 1.05 }),
        rect(m, m * 0.6 + numSize * 1.05 * 1.13, Math.min(inner, 220 * u), Math.max(8, 14 * u), p.ink),
        textbox(i.title, m, m * 0.6 + numSize * 1.12 * 1.13 + 34 * u, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15 }),
        textbox(i.subtitle, m, h * 0.62, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 32 * u), fill: p.sub }),
      ] };
    },
  },
  {
    id: 'impact', zh: '油管冲击', en: 'Impact', fit: ['youtube', 'bilibili', 'bilibili-43', 'bilibili-hd', 'wide', 'vertical'], zhUse: '黄字黑描边 + 红标，右侧留人像位；短标题（≤8 字）效果最好', enUse: 'Yellow type with a black outline, red tag, subject area on the right; keep titles short',
    photo: true,
    slot: i => { const { w, h, wide } = metrics(i); return wide ? { x: w * 0.6, y: 0, w: w * 0.4, h, radius: 0 } : undefined; },
    build(i) {
      const p = palette(i, { bg: '#0b1020', bg2: '#1d2b64', ink: '#ffe14a', sub: '#ffffff', accent: '#ef233c', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = wide ? w * 0.58 - m : w - m * 2;
      const shown = upper(i.title); const size = fitTitle(shown, inner, h * (wide ? 0.62 : 0.5), 230 * u, 44, 1.05);
      const top = h - m * 1.1 - (i.subtitle.trim() ? 90 * u : 0) - textHeight(shown, inner, size, 1.05);
      const glow = softGlow(w * (wide ? 0.56 : 0.4), -h * 0.05, Math.min(w, h) * 0.62, p.accent, 0.55);
      const scrim = rect(0, h * 0.35, w, h * 0.65, new Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: 0, y2: h * 0.65 }, colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.65)' }] }), { qcRole: 'scrim' });
      return { background: linear(p, 135), objects: [
        glow, scrim,
        ...badge(i.badge, m, m, p, Math.max(26, 40 * u), { fontWeight: 'bold' }),
        textbox(shown, m, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.05, stroke: '#000000', strokeWidth: Math.max(8, 14 * u), shadow: shadowHard(u, '#000000', 7) }),
        ...(i.subtitle.trim() ? [pill(i.subtitle, m, 0, 'rgba(0,0,0,0.55)', p.sub, Math.max(24, 36 * u), { qcRole: 'subtitle', radius: 0.18 })].map(b => { b.set({ top: h - m - b.height }); return b; }) : []),
      ] };
    },
  },

  {
    id: 'compare', zh: '对比', en: 'Versus', fit: [...XHS, ...VIDEO], zhUse: '左右两栏对比：副标题用 “A | B” 或“前 | 后”，评测 / 前后效果', enUse: 'Two panels; subtitle as “A | B”; reviews and before/after',
    build(i) {
      const p = palette(i, { bg: '#f8fafc', bg2: '#f8fafc', ink: '#0f172a', sub: '#334155', accent: '#16a34a', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2;
      const parts = (i.points?.length ? i.points : i.subtitle.split(/\s*(?:\||｜|\bvs\.?\b|VS|对比|→)\s*/i)).map(s => s.trim()).filter(Boolean);
      const a = parts[0] ?? (i.zh ? '之前' : 'Before'); const b = parts[1] ?? (i.zh ? '之后' : 'After');
      const titleSize = fitTitle(i.title, inner, h * 0.22, 100 * u, 32, 1.12); const top = m + (i.badge?.trim() ? 64 * u : 0); const panelTop = top + textHeight(i.title, inner, titleSize, 1.12) + 24 * u; const panelH = h - panelTop - m;
      const gap = 28 * u; const pw = wide ? (inner - gap) / 2 : inner; const ph = wide ? panelH : (panelH - gap) / 2;
      const panel = (x: number, y: number, fill: string, ink: string, label: string, mark: string): FabricObject[] => {
        const fs = Math.max(30, Math.min(ph * 0.3, pw / Math.max(3, [...label].length * (hasCjk(label) ? 1 : 0.6)) * 1.1, 96 * u));
        return [rect(x, y, pw, ph, fill, { rx: 28 * u, ry: 28 * u }),
          textbox(mark, x + 28 * u, y + 20 * u, pw - 56 * u, { fontSize: Math.max(24, 44 * u), fill: ink, fontWeight: 'bold', opacity: 0.9 }),
          textbox(label, x + 28 * u, y + ph / 2 - textHeight(label, pw - 56 * u, fs, 1.15) / 2, pw - 56 * u, { fontSize: fs, fill: ink, fontWeight: 'bold', lineHeight: 1.15 })];
      };
      const vs = new Circle({ left: wide ? m + pw + gap / 2 - 44 * u : w / 2 - 44 * u, top: wide ? panelTop + ph / 2 - 44 * u : panelTop + ph + gap / 2 - 44 * u, radius: 44 * u, fill: p.ink, stroke: p.bg, strokeWidth: 8 * u, originX: 'left', originY: 'top' });
      const vsText = textbox('VS', vs.left, vs.top + 26 * u, 88 * u, { fontSize: Math.max(22, 34 * u), fill: p.bg, fontWeight: 'bold', textAlign: 'center' });
      return { background: solid(p.bg), objects: [
        ...badge(i.badge, m, m, p, Math.max(20, 28 * u)),
        textbox(i.title, m, top, inner, { qcRole: 'title', fontSize: titleSize, fill: p.ink, fontWeight: 'bold', lineHeight: 1.12 }),
        ...panel(m, panelTop, '#fee2e2', '#991b1b', a, '✕'),
        ...panel(wide ? m + pw + gap : m, wide ? panelTop : panelTop + ph + gap, '#dcfce7', '#166534', b, '✓'),
        vs, vsText,
      ] };
    },
  },
  {
    id: 'neo', zh: '新粗野', en: 'Neo-brutal', fit: [...XHS, ...VIDEO, ...SHORT], zhUse: '黑粗框 + 硬阴影 + 荧光底，年轻、有趣、辨识度高', enUse: 'Thick black borders, hard shadows, bright backdrop',
    build(i) {
      const p = palette(i, { bg: '#a3e635', bg2: '#a3e635', ink: '#111111', sub: '#111111', accent: '#ff5fa2', accentInk: '#111111' });
      const { u, m, w, h } = metrics(i); const bw = Math.max(5, 8 * u); const cx = m * 0.9; const cw = w - cx * 2; const ch = h - cx * 2; const pad = m * 0.9;
      const size = fitTitle(i.title, cw - pad * 2, ch * 0.55, 140 * u, 38, 1.12);
      const th = textHeight(i.title, cw - pad * 2, size, 1.12); const subS = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? subS * 1.7 + 34 * u : 0; const ty = cx + (ch - th - subH) / 2;
      const card = rect(cx, cx, cw, ch, '#ffffff', { stroke: p.ink, strokeWidth: bw, rx: 14 * u, ry: 14 * u, shadow: shadowHard(u, p.ink, 16) });
      const tag = pill(i.badge?.trim() || (i.zh ? '必看' : 'MUST'), 0, cx - 22 * u, p.accent, p.accentInk, Math.max(22, 36 * u), { qcRole: 'badge', angle: 5, radius: 0.2 }); tag.set({ left: cx + cw - tag.width - 24 * u });
      return { background: solid(p.bg), objects: [
        card, tag,
        textbox(i.title, cx + pad, ty, cw - pad * 2, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.12 }),
        ...(i.subtitle.trim() ? [pill(i.subtitle, cx + pad, ty + th + 34 * u, '#ffe04b', p.sub, subS, { qcRole: 'subtitle', radius: 0.2 })] : []),
      ] };
    },
  },
  {
    id: 'soft', zh: '柔雾莫兰迪', en: 'Soft haze', fit: [...XHS, ...BANNER], zhUse: '低饱和柔光，适合生活方式、情绪、穿搭、女性向', enUse: 'Muted haze; lifestyle, mood, fashion',
    build(i) {
      const p = palette(i, { bg: '#f6e7e3', bg2: '#e4dcf3', ink: '#3b2f4a', sub: '#7a6b8a', accent: '#b794d6', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2; const size = fitTitle(i.title, inner, h * 0.46, 118 * u);
      const blob = (x: number, y: number, r: number, c: string, o: number): Circle => new Circle({ left: x, top: y, radius: r, fill: c, opacity: o, originX: 'left', originY: 'top' });
      return { background: linear(p, 150), objects: [
        blob(w * 0.52, -h * 0.12, Math.min(w, h) * 0.5, '#ffffff', 0.5), blob(-w * 0.12, h * 0.62, Math.min(w, h) * 0.46, p.accent, 0.28), blob(w * 0.7, h * 0.66, Math.min(w, h) * 0.2, '#f9a8d4', 0.4),
        ...badge(i.badge, m, m, p, Math.max(20, 28 * u)),
        textbox(i.title, m, h * 0.3, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.2 }),
        textbox(i.subtitle, m, h - m - 84 * u, inner, { qcRole: 'subtitle', fontSize: Math.max(24, 32 * u), fill: p.sub }),
      ] };
    },
  },
];
export function templateById(id: string): Template | undefined { return TEMPLATES.find(t => t.id === id); }

/* ---------- premium templates: each one a distinct, finished visual style ---------- */
const keep = <T,>(...xs: (T | undefined | false)[]): T[] => xs.filter((x): x is T => !!x);
const meta = (text: string, left: number, top: number, width: number, size: number, fill: string, o: Partial<TextOptions> = {}): Textbox => textbox(text, left, top, width, { fontSize: size, fill, fontWeight: 'bold', charSpacing: 220, lineHeight: 1.1, ...o });
const sub = (i: TemplateInput, left: number, top: number, width: number, size: number, fill: string, o: Partial<TextOptions> = {}): Textbox[] => i.subtitle.trim() ? [textbox(i.subtitle, left, top, width, { qcRole: 'subtitle', fontSize: size, fill, ...o })] : [];

const PREMIUM: Template[] = [
  {
    id: 'swiss', zh: '瑞士网格', en: 'Swiss grid', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '米白底 + 红圆 + 极粗无衬线 + 网格细线，国际主义风格', enUse: 'Off-white, a red disc, ultra-bold sans and grid hairlines',
    build(i) {
      const p = palette(i, { bg: '#f3f1ea', bg2: '#f3f1ea', ink: '#111111', sub: '#555555', accent: '#e63312', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2; const tw = wide ? inner * 0.7 : inner;
      const size = fitTitle(i.title, tw, h * (wide ? 0.58 : 0.4), 230 * u, 40, 0.98); const th = textHeight(i.title, tw, size, 0.98);
      const r = Math.min(w, h) * (wide ? 0.34 : 0.3); const subSize = Math.max(26, 36 * u); const top = h - m - (i.subtitle.trim() ? subSize * 1.5 + 30 * u : 0) - th;
      const cols = wide ? 6 : 4;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.06, 3),
        ...Array.from({ length: cols - 1 }, (_, k) => rule(m + (inner / cols) * (k + 1), 0, h, p.ink, Math.max(1, u), true, 0.1)),
        new Circle({ left: w - r * 1.1, top: m * 0.9, radius: r, fill: p.accent, originX: 'left', originY: 'top' }),
        i.badge?.trim() ? textbox(i.badge.trim(), m, m * 0.8, inner * 0.4, { qcRole: 'badge', fontSize: Math.max(60, 120 * u), fill: p.ink, fontWeight: 'bold', lineHeight: 1, charSpacing: -30 }) : undefined,
        meta('NO. — / 2026', m, m * 0.8 + (i.badge?.trim() ? Math.max(60, 120 * u) * 1.15 : 0), inner * 0.5, Math.max(16, 20 * u), p.sub),
        textbox(i.title, m, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 0.98, charSpacing: -30 }),
        ...sub(i, m, top + th + 26 * u, tw, subSize, p.sub, { fontWeight: 'bold' }),
      ) };
    },
  },
  {
    id: 'acid', zh: '酸性渐变', en: 'Acid mesh', fit: [...XHS, ...VIDEO, ...SHORT], zhUse: '浅粉紫弥散光斑 + 颗粒 + 居中深紫大字 + 一枚闪光；潮流、音乐、AI 话题', enUse: 'Pastel mesh glows and grain, a centred deep-violet headline and one sparkle; trendy, music, AI',
    build(i) {
      const p = palette(i, { bg: '#ffe3ef', bg2: '#ddd3ff', ink: '#24104a', sub: '#5b3f8c', accent: '#ff3d8b', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2; const tw = wide ? inner * 0.82 : inner;
      const size = fitTitle(i.title, tw, h * 0.5, 210 * u, 40, 1.02); const th = textHeight(i.title, tw, size, 1.02);
      const subS = Math.max(26, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, inner, subS, 1.25) + 30 * u : 0; const bs = Math.max(20, size * 0.18); const bH = i.badge?.trim() ? bs * 1.3 * 1.7 + 30 * u : 0;
      const top = (h - th - subH - bH) / 2 + bH;
      return { background: linear(p, 160), objects: keep<FabricObject>(
        kitGlow(w * 0.15, h * 0.28, Math.min(w, h) * 0.6, p.accent, 0.5), kitGlow(w * 0.88, h * 0.78, Math.min(w, h) * 0.55, '#38bdf8', 0.5), kitGlow(w * 0.55, h * 0.02, Math.min(w, h) * 0.4, '#fde047', 0.7),
        grain(w, h, 0.12, 11),
        ...badge(i.badge, 0, top - bH, p, bs, { angle: -4 }).map(b => { b.set({ left: w / 2 - b.width / 2 }); return b; }),
        textbox(i.title, m + (inner - tw) / 2, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.02, textAlign: 'center' }),
        ...sub(i, m, top + th + 30 * u, inner, subS, p.sub, { textAlign: 'center', fontWeight: 'bold' }),
        sparkle(w - m * 1.3, wide ? h * 0.2 : h * 0.14, 90 * u, p.accent, 12),
      ) };
    },
  },
  {
    id: 'collage', zh: '拼贴手账', en: 'Paper collage', fit: [...XHS, 'bilibili', 'wechat'], zhUse: '牛皮纸 + 撕纸色块 + 胶带 + 贴纸，生活、手账、种草', enUse: 'Kraft paper, torn colour blocks, tape and stickers; lifestyle and journaling',
    build(i) {
      const p = palette(i, { bg: '#e6d5b8', bg2: '#e6d5b8', ink: '#2b2118', sub: '#6e5b45', accent: '#ef6f4f', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const pw = w - m * 2.2; const ph = h * (wide ? 0.7 : 0.52); const px = (w - pw) / 2; const py = (h - ph) / 2;
      const inner = pw - m * 1.4; const size = fitTitle(i.title, inner, ph * 0.56, 170 * u, 36, 1.08); const th = textHeight(i.title, inner, size, 1.08);
      const ty = py + (ph - th - (i.subtitle.trim() ? 80 * u : 0)) / 2;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.12, 5), blob(w * 0.82, h * 0.2, Math.min(w, h) * 0.55, p.accent, 0.9, 20), blob(w * 0.14, h * 0.82, Math.min(w, h) * 0.45, '#8ec5a3', 0.85, -30),
        rect(px - 18 * u, py + 22 * u, pw, ph, p.accent, { angle: 3 }),
        paper(px, py, pw, ph, '#fffaf0', -1.6, u),
        tape(px + pw * 0.12, py - 22 * u, 160 * u, 46 * u, -8), tape(px + pw * 0.72, py + ph - 24 * u, 150 * u, 44 * u, 6, 'rgba(255,140,170,0.7)'),
        textbox(i.title, px + m * 0.7, ty, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08, charSpacing: -14, angle: -1.6 }),
        ...sub(i, px + m * 0.7, ty + th + 22 * u, inner, Math.max(26, 38 * u), p.sub, { angle: -1.6 }),
        ...(i.badge?.trim() ? stickerDot(px + pw - 40 * u, py - 10 * u, 78 * u, '#ffd23f', i.badge.trim(), p.ink, 10, '#ffffff') : []),
        sparkle(px + 30 * u, py + ph + 10 * u, 70 * u, p.accent, -10),
      ) };
    },
  },
  {
    id: 'mega', zh: '大字满版', en: 'Mega type', fit: [...XHS, ...SHORT, 'youtube'], zhUse: '标题放大到撑满画面，高饱和纯色底，最强的信息流冲击力', enUse: 'The headline fills the artboard on a saturated colour; maximum scroll-stopping force',
    build(i) {
      const p = palette(i, { bg: '#ff4d2e', bg2: '#ff4d2e', ink: '#fff4e6', sub: '#1a1209', accent: '#1a1209', accentInk: '#fff4e6' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 1.6;
      const size = fitTitle(i.title, inner, h * 0.74, 480 * u, 40, 0.92); const th = textHeight(i.title, inner, size, 0.92); const top = (h - th) / 2 - (i.subtitle.trim() ? 30 * u : 0);
      const subPill = i.subtitle.trim() ? [pill(i.subtitle, 0, 0, p.accent, p.accentInk, Math.max(26, 36 * u), { qcRole: 'subtitle', radius: 0.5 })].map(b => { b.set({ left: m * 0.8, top: Math.min(h - m * 0.8 - b.height, top + th + 24 * u) }); return b; }) : [];
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.09, 13), ...badge(i.badge, m * 0.8, m * 0.6, { ...p, accent: p.accent, accentInk: p.accentInk }, Math.max(20, 26 * u)),
        textbox(i.title, m * 0.8, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 0.92, charSpacing: -40 }), ...subPill,
      ) };
    },
  },
  {
    id: 'ticker', zh: '跑马灯', en: 'Ticker', fit: [...VIDEO, ...XHS], zhUse: '奶黄底 + 斜向滚动字带 + 硬阴影大字，B 站 / YouTube 的信息流利器', enUse: 'Cream with diagonal ticker bands and hard-shadow type; built for video feeds',
    build(i) {
      const p = palette(i, { bg: '#fff1c9', bg2: '#ffd9b3', ink: '#ffffff', sub: '#2a1d0c', accent: '#111111', accentInk: '#facc15' });
      const { u, m, w, h } = metrics(i); const inner = w - m * 2; const word = (i.badge?.trim() || i.subtitle.trim() || 'NEW').slice(0, 14); const bh = Math.max(70, 100 * u);
      const size = fitTitle(i.title, inner, h * 0.44, 230 * u, 40, 1.02); const th = textHeight(i.title, inner, size, 1.02); const top = (h - th) / 2;
      return { background: linear(p, 180), objects: keep<FabricObject>(
        kitGlow(w * 0.5, h * 0.5, Math.min(w, h) * 0.7, '#fb7185', 0.3), grain(w, h, 0.1, 17),
        ...ticker(w, h * 0.1, bh, word, bh * 0.52, p.accentInk, p.accent, -5), ...ticker(w, h * 0.82, bh, word, bh * 0.52, p.ink, '#ef4444', 4),
        textbox(i.title, m, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.02, textAlign: 'center', stroke: '#000000', strokeWidth: Math.max(6, 12 * u), shadow: shadowHard(u, '#7c3aed', 9), charSpacing: -10 }),
        ...sub(i, m, top + th + 24 * u, inner, Math.max(26, 38 * u), p.sub, { textAlign: 'center', fontWeight: 'bold' }),
      ) };
    },
  },
  {
    id: 'memo', zh: '便签笔记', en: 'Memo paper', fit: [...XHS, 'wechat'], zhUse: '横线笔记纸 + 红色页边线 + 荧光笔划重点，学习、笔记、干货', enUse: 'Ruled notebook paper with a margin line and a highlighter; study notes and tips',
    build(i) {
      const p = palette(i, { bg: '#fbf8ef', bg2: '#fbf8ef', ink: '#1d2a44', sub: '#5b6a86', accent: '#fde047', accentInk: '#1d2a44' });
      const { u, m, w, h } = metrics(i); const left = m * 1.9; const inner = w - left - m; const size = fitTitle(i.title, inner, h * 0.42, 150 * u, 36, 1.12); const th = textHeight(i.title, inner, size, 1.12);
      const gap = Math.max(48, 74 * u); const top = Math.round((h * 0.28) / gap) * gap + 6;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.07, 21),
        ...Array.from({ length: Math.floor(h / gap) }, (_, k) => rule(0, gap * (k + 1.5), w, '#9db4d6', Math.max(1.4, 2 * u), false, 0.55)),
        rule(m * 1.45, 0, h, '#e8706a', Math.max(2, 3 * u), true, 0.8),
        ...Array.from({ length: 3 }, (_, k) => new Circle({ left: m * 0.5, top: h * (0.2 + k * 0.3), radius: 16 * u, fill: '#e8dfc9', stroke: '#c9bd9f', strokeWidth: 2, originX: 'left', originY: 'top' })),
        rect(left - 10 * u, top + size * 0.62, Math.min(inner, textWidth(i.title.split('\n')[0] ?? i.title, size, 'bold') + 20 * u), size * 0.5, p.accent, { opacity: 0.85, angle: -0.8 }),
        ...badge(i.badge, left, top - Math.max(54, 70 * u), { ...p, accent: '#ef4444', accentInk: '#ffffff' }, Math.max(20, 26 * u), { angle: -3 }),
        textbox(i.title, left, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.12, charSpacing: -10 }),
        ...sub(i, left, top + th + 26 * u, inner, Math.max(26, 38 * u), p.sub),
      ) };
    },
  },
  {
    id: 'pop', zh: '贴纸波普', en: 'Pop sticker', fit: [...XHS, ...VIDEO, ...SHORT], zhUse: '明黄底 + 黑色粗标题 + 几枚歪贴的粉、蓝、绿色块贴纸 + 白色胶囊副标题；年轻好玩，但不靠描边、硬投影和爆炸星', enUse: 'Yellow, heavy black type, a few tilted pink, blue and green stickers and a white pill subtitle; playful without outlines, hard shadows or bursts',
    build(i) {
      const p = palette(i, { bg: '#ffd23f', bg2: '#ffd23f', ink: '#151515', sub: '#151515', accent: '#ff4f8b', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.1; const tw = (w - x0 * 2) * (wide ? 0.7 : 1); const s0 = Math.min(w, h);
      const size = fitTitle(i.title, tw, h * (wide ? 0.54 : 0.4), 230 * u, 40, 1.04); const th = textHeight(i.title, tw, size, 1.04);
      const subS = Math.max(26, size * 0.3); const subH = i.subtitle.trim() ? subS * 1.7 + 34 * u : 0; const top = (h - th - subH) / 2 + (wide ? 0 : h * 0.03);
      const dots: FabricObject[] = []; const step = 84 * u; for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) dots.push(dot(x, y, 7 * u, 'rgba(0,0,0,0.06)'));
      const r = s0 * (wide ? 0.2 : 0.17); const sx = w - m * 0.6 - r, sy = m * 0.6 + r;
      const word = i.badge?.trim() ?? ''; const tag = word ? stickerDot(sx, sy, r, p.accent, hasCjk(word) ? [...word].slice(0, 4).join('') : word.slice(0, 8), p.accentInk, 8) : [dot(sx, sy, r, p.accent)];
      return { background: solid(p.bg), objects: keep<FabricObject>(
        ...dots, rect(-s0 * 0.05, h - s0 * 0.26, s0 * 0.3, s0 * 0.3, '#3b82f6', { rx: s0 * 0.06, ry: s0 * 0.06, angle: 12 }), dot(w - m * 1.2, h - s0 * 0.18, s0 * 0.06, '#22c55e'),
        sparkle(x0 + 30 * u, top - 70 * u, 70 * u, '#ffffff', 0), ...tag,
        textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.04, charSpacing: -18 }),
        ...(i.subtitle.trim() ? [pill(i.subtitle, x0, top + th + 34 * u, '#ffffff', p.ink, subS, { qcRole: 'subtitle', radius: 0.5 })] : []),
      ) };
    },
  },
  {
    id: 'mag', zh: '杂志封面', en: 'Magazine', fit: [...BANNER, ...XHS, 'bilibili'], zhUse: '纸质底 + 衬线巨标题 + 巨型虚影期号 + 报头细线，像一本真杂志', enUse: 'Paper, a huge serif headline, a ghost issue numeral and masthead rules; a real magazine cover',
    build(i) {
      const p = palette(i, { bg: '#efe7d8', bg2: '#e5dac4', ink: '#17130d', sub: '#6b5f4b', accent: '#b6402a', accentInk: '#fff7ea' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2; const tw = wide ? inner * 0.62 : inner * 0.94; const topY = m * 0.7; const num = digits(i, false);
      const size = fitTitle(i.title, tw, h * (wide ? 0.6 : 0.34), 200 * u, 40, 1.0); const th = textHeight(i.title, tw, size, 1.0); const ty = topY + (wide ? 100 : 96) * u;
      const subSize = Math.max(26, 38 * u);
      const titleBox = textbox(i.title, m, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.0, charSpacing: -20 }); const titleH = Math.max(th, titleBox.height * titleBox.scaleY);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.1),
        ghost(num, wide ? w * 0.56 : w * 0.06, wide ? -h * 0.12 : h * 0.4, wide ? h * 1.1 : h * 0.62, p.accent, 0.16, false),
        rule(m, topY, inner, p.ink, 5 * u), rule(m, topY + 14 * u, inner, p.ink, 1.4 * u),
        meta(`NO.${num}`, m, topY + 32 * u, inner * 0.5, Math.max(18, 22 * u), p.ink), meta('COVER STORY', m + inner * 0.5, topY + 32 * u, inner * 0.5, Math.max(18, 22 * u), p.sub, { textAlign: 'right' }),
        sideText('THE COVER STORY · SPECIAL EDITION · 2026', w - m * 0.62, m * 2.2, h - m * 4, Math.max(14, 17 * u), p.sub, 'down', 0.8),
        titleBox,
        rect(m, ty + titleH + 24 * u, 84 * u, Math.max(5, 7 * u), p.accent),
        ...sub(i, m, ty + titleH + 46 * u, tw, subSize, p.sub, { fontFamily: SERIF, fontStyle: 'italic' }),
        metaBlock(['VOL. 2026', 'SPECIAL EDITION'], m, h - m * 0.9 - 60 * u, inner * 0.4, Math.max(14, 17 * u), p.ink), metaBlock(['QIAOMU', 'COVER DESIGN'], m + inner * 0.6, h - m * 0.9 - 60 * u, inner * 0.4, Math.max(14, 17 * u), p.ink, 'right'),
        ...(i.badge?.trim() ? stickerDot(w - m - 90 * u, topY + 250 * u, 80 * u, p.accent, i.badge.trim().slice(0, 4), p.accentInk, -10) : []),
      ) };
    },
  },
  {
    id: 'print', zh: '印刷海报', en: 'Print poster', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '黑 + 米白 + 一抹朱红，裁切线、套准标、沿边文字、条码，欧洲字体海报的语汇', enUse: 'Black, paper and one vermilion; crop marks, registration target, edge text and barcode: the European typographic poster vocabulary',
    build(i) {
      const p = palette(i, { bg: '#f2efe6', bg2: '#f2efe6', ink: '#0d0d0d', sub: '#4a4a4a', accent: '#ff3b1f', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2.4; const x0 = m * 1.2; const tw = wide ? inner * 0.78 : inner;
      const subS = Math.max(26, 38 * u); const subLines = i.subtitle.trim() ? lineCount(i.subtitle, inner - 44 * u, subS) : 0; // the bar grows with the subtitle, so a second line stays on red
      const subH = subLines ? Math.max(60, 92 * u, subLines * subS * 1.25 * 1.13 + 40 * u) : 0; const bottom = h - m * 1.15; const head = m * 0.9 + 100 * u + (i.badge?.trim() ? Math.max(16, 20 * u) * 2.6 : 0) + 24 * u;
      // The headline lives between the label block and the red bar; a taller one would be pushed down onto the bar.
      const size = fitTitle(i.title, tw, Math.min(h * (wide ? 0.62 : 0.5), (bottom - subH - 28 * u - head) * 0.86), 280 * u, 40, 0.94); const th = textHeight(i.title, tw, size, 0.94);
      const top = bottom - subH - 28 * u - size * 0.16 - th; const num = digits(i, false);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.1, 41), ...cropMarks(w, h, m * 0.42, 30 * u, p.ink, Math.max(1.5, 2 * u)), ...regMark(w - m * 1.1, m * 1.0, 15 * u, p.ink, Math.max(1.5, 2 * u)),
        sideText('SERIES 2026 — COVER PROGRAM — SERIES 2026 — COVER PROGRAM', m * 0.2, m * 1.7, h - m * 3.4, Math.max(13, 15 * u), p.ink, 'up', 0.7),
        metaBlock([`NO.${num}`, 'VOL. 2026', 'ISSUE'], x0, m * 0.9, inner * 0.3, Math.max(14, 17 * u), p.ink),
        ...barcode(w - m * 1.2 - 150 * u, m * 1.9, 150 * u, 54 * u, p.ink, 6),
        textbox('→', w - m * 1.2 - 130 * u, h * (wide ? 0.18 : 0.3), 130 * u, { fontSize: 130 * u, fill: p.accent, fontWeight: 'bold', lineHeight: 1, textAlign: 'right' }),
        textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 0.94, charSpacing: -40 }),
        ...(i.subtitle.trim() ? [rect(x0, bottom - subH, inner, subH, p.accent), ...sub(i, x0 + 22 * u, bottom - subH + (subH - subLines * subS * 1.25 * 1.13) / 2, inner - 44 * u, subS, p.accentInk, { fontWeight: 'bold' })] : []),
        ...badge(i.badge, x0, m * 0.9 + 100 * u, { ...p, accent: p.ink, accentInk: p.bg }, Math.max(16, 20 * u)),
      ) };
    },
  },
  {
    id: 'glass', zh: '玻璃卡片', en: 'Glass card', fit: [...XHS, ...VIDEO, ...BANNER], zhUse: '粉蓝弥散背景 + 大幅磨砂玻璃卡片 + 悬浮小胶囊，现代、产品、App 感', enUse: 'Pastel mesh background, a large frosted glass card and floating pills; modern, product, app',
    build(i) {
      const p = palette(i, { bg: '#ffd1e8', bg2: '#c7d7ff', ink: '#2b1b57', sub: 'rgba(43,27,87,0.78)', accent: '#2b1b57', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const cw = w - m * 1.6; const ch = h * (wide ? 0.8 : 0.64); const cx = (w - cw) / 2; const cy = (h - ch) / 2; const pad = m * 0.85; const inner = cw - pad * 2;
      const size = fitTitle(i.title, inner, ch * 0.46, 170 * u, 36, 1.05); const th = textHeight(i.title, inner, size, 1.05); const ty = cy + pad + (i.badge?.trim() ? Math.max(58, 76 * u) : 0) + (ch - pad * 2 - th - (i.subtitle.trim() ? 130 * u : 40 * u)) * 0.28;
      const pts = (i.points ?? []).slice(0, 3);
      return { background: linear(p, 150), objects: keep<FabricObject>(
        kitGlow(w * 0.18, h * 0.16, Math.min(w, h) * 0.65, '#22d3ee', 0.65), kitGlow(w * 0.9, h * 0.86, Math.min(w, h) * 0.65, '#f59e0b', 0.6), kitGlow(w * 0.5, h * 0.5, Math.min(w, h) * 0.5, '#6366f1', 0.4), grain(w, h, 0.1, 9),
        rect(cx, cy, cw, ch, 'rgba(255,255,255,0.5)', { rx: 56 * u, ry: 56 * u, stroke: 'rgba(255,255,255,0.95)', strokeWidth: Math.max(2, 3 * u), shadow: new Shadow({ color: 'rgba(90,60,160,0.28)', blur: 70 * u, offsetX: 0, offsetY: 28 * u }) }),
        rect(cx + cw - 230 * u, cy - 38 * u, 250 * u, 84 * u, 'rgba(255,255,255,0.75)', { rx: 42 * u, ry: 42 * u, stroke: 'rgba(255,255,255,0.95)', strokeWidth: Math.max(2, 3 * u) }),
        textbox('✦  NEW', cx + cw - 230 * u, cy - 38 * u + 22 * u, 250 * u, { fontSize: Math.max(22, 30 * u), fill: p.ink, fontWeight: 'bold', textAlign: 'center', charSpacing: 120 }),
        ...badge(i.badge, cx + pad, cy + pad * 0.8, p, Math.max(18, 24 * u)),
        textbox(i.title, cx + pad, ty, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.05, charSpacing: -16, shadow: new Shadow({ color: 'rgba(255,255,255,0.7)', blur: 18 * u, offsetX: 0, offsetY: 4 * u }) }),
        rule(cx + pad, ty + th + 26 * u, inner, 'rgba(43,27,87,0.2)', Math.max(1.5, 2 * u)),
        ...sub(i, cx + pad, ty + th + 48 * u, inner, Math.max(26, 38 * u), p.sub),
        ...pts.map((t, k) => pill(t, cx + pad + k * 200 * u, cy + ch - pad * 0.7 - 56 * u, 'rgba(43,27,87,0.1)', p.ink, Math.max(18, 24 * u), { radius: 0.5, padX: 0.8 })),
      ) };
    },
  },
  {
    id: 'bento', zh: '便当清单', en: 'Bento list', fit: [...XHS, 'wechat'], zhUse: '深色标题卡 + 三张彩色要点卡拼成便当格，信息密度高又好看', enUse: 'A dark headline card and three colour cards in a bento grid; dense and good looking',
    build(i) {
      const p = palette(i, { bg: '#ecebe4', bg2: '#ecebe4', ink: '#141414', sub: '#6b6b6b', accent: '#ffd23f', accentInk: '#141414' });
      const { u, m, w, h, wide } = metrics(i); const gap = 20 * u; const rows = (i.points?.length ? i.points : i.subtitle.split(/[\n,，、；;]/)).map(x => x.trim()).filter(Boolean).slice(0, 3);
      const items = [...rows, ...(i.zh ? ['先明确目标', '再拆解步骤', '最后复盘'] : ['Set the goal', 'Break it down', 'Review']).slice(rows.length)].slice(0, 3);
      const x0 = m * 0.75; const y0 = m * 0.75; const W = w - x0 * 2; const H = h - y0 * 2; const colors = [p.accent, '#ff7a6b', '#7dd3c0'];
      const hw = wide ? W * 0.46 : W; const hh = wide ? H : H * 0.38; const inner = hw - m * 1.1;
      const size = fitTitle(i.title, inner, hh * (wide ? 0.72 : 0.62), 240 * u, 36, 1.04); const th = textHeight(i.title, inner, size, 1.04);
      const gx = wide ? x0 + hw + gap : x0; const gy = wide ? y0 : y0 + hh + gap; const gw = wide ? W - hw - gap : W; const gh = wide ? H : H - hh - gap;
      const slots = wide ? [[gx, gy, gw, gh * 0.5 - gap / 2], [gx, gy + gh * 0.5 + gap / 2, gw / 2 - gap / 2, gh * 0.5 - gap / 2], [gx + gw / 2 + gap / 2, gy + gh * 0.5 + gap / 2, gw / 2 - gap / 2, gh * 0.5 - gap / 2]]
        : [[gx, gy, gw, gh * 0.46 - gap / 2], [gx, gy + gh * 0.46 + gap / 2, gw / 2 - gap / 2, gh * 0.54 - gap / 2], [gx + gw / 2 + gap / 2, gy + gh * 0.46 + gap / 2, gw / 2 - gap / 2, gh * 0.54 - gap / 2]];
      const cards = items.flatMap((label, k) => { const [sx, sy, sw, sh] = slots[k]! as [number, number, number, number]; const big = k === 0;
        return [rect(sx, sy, sw, sh, colors[k]!, { rx: 40 * u, ry: 40 * u }), textbox(String(k + 1).padStart(2, '0'), sx + 28 * u, sy + 22 * u, sw - 50 * u, { fontSize: Math.max(40, (big ? 120 : 88) * u), fill: 'rgba(0,0,0,0.28)', fontWeight: 'bold', lineHeight: 1, charSpacing: -30 }),
          textbox(label, sx + 28 * u, sy + sh - 28 * u - Math.max(36, (big ? 64 : 48) * u) * 2.4, sw - 56 * u, { fontSize: Math.max(26, (big ? 60 : 46) * u), fill: p.ink, fontWeight: 'bold', lineHeight: 1.12 })]; });
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.06, 43),
        rect(x0, y0, hw, hh, '#141414', { rx: 40 * u, ry: 40 * u }),
        ...badge(i.badge, x0 + m * 0.55, y0 + m * 0.5, p, Math.max(18, 24 * u)),
        textbox(i.title, x0 + m * 0.55, y0 + hh - m * 0.55 - th, inner, { qcRole: 'title', fontSize: size, fill: '#ffffff', fontWeight: 'bold', lineHeight: 1.04, charSpacing: -16 }),
        ...cards,
      ) };
    },
  },
  {
    id: 'neon', zh: '霓虹网格', en: 'Neon grid', fit: [...VIDEO, ...BANNER, ...XHS], zhUse: '深色透视网格 + 霓虹发光字 + 取景框角标，AI、编程、赛博', enUse: 'Dark perspective grid, neon glow type and viewfinder corners; AI, code, cyber',
    build(i) {
      const p = palette(i, { bg: '#05060d', bg2: '#0b1226', ink: '#f8fafc', sub: '#7dd3fc', accent: '#22d3ee', accentInk: '#02131a' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2; const tw = wide ? inner * 0.74 : inner;
      const size = fitTitle(i.title, tw, h * 0.46, 200 * u, 40, 1.04); const th = textHeight(i.title, tw, size, 1.04); const top = (h - th) / 2 - 20 * u;
      const lines: FabricObject[] = []; const gy = h * 0.64;
      for (let k = 0; k <= 12; k++) { const x = (w / 12) * k; lines.push(new Line([w / 2 + (x - w / 2) * 0.12, gy, x, h], { stroke: p.accent, strokeWidth: Math.max(1, 1.6 * u), opacity: 0.22, originX: 'left', originY: 'top', left: Math.min(w / 2 + (x - w / 2) * 0.12, x), top: gy })); }
      for (let k = 1; k <= 6; k++) { const y = gy + (h - gy) * (k / 6) ** 1.8; lines.push(rule(0, y, w, p.accent, Math.max(1, 1.6 * u), false, 0.2)); }
      return { background: linear(p, 180), objects: keep<FabricObject>(
        kitGlow(w * 0.2, h * 0.3, Math.min(w, h) * 0.55, '#a855f7', 0.5), kitGlow(w * 0.8, h * 0.6, Math.min(w, h) * 0.55, p.accent, 0.5), ...lines, grain(w, h, 0.09, 23),
        ...cropMarks(w, h, m * 0.5, 40 * u, p.accent, Math.max(2, 3 * u)),
        meta(`● REC  ${(i.badge?.trim() || 'SYS')} / ONLINE`, m, m * 0.85, inner * 0.7, Math.max(16, 20 * u), p.sub, { fontFamily: 'monospace', charSpacing: 120 }),
        textbox(i.title, m, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.04, shadow: new Shadow({ color: p.accent, blur: 34 * u, offsetX: 0, offsetY: 0 }), charSpacing: -10 }),
        ...sub(i, m, top + th + 26 * u, inner, Math.max(26, 36 * u), p.sub, { fontWeight: 'bold' }),
        meta('00:03:21:07', m, h - m * 0.85 - 22 * u, inner * 0.5, Math.max(14, 18 * u), p.sub, { fontFamily: 'monospace' }), meta('2.39:1', m + inner * 0.5, h - m * 0.85 - 22 * u, inner * 0.5, Math.max(14, 18 * u), p.sub, { fontFamily: 'monospace', textAlign: 'right' }),
      ) };
    },
  },
  {
    id: 'calm', zh: '松弛留白', en: 'Calm paper', fit: [...XHS, ...BANNER], zhUse: '云舞白纸 + 大号衬线标题 + 竖线与弧线 + 沿边小字，克制的“冷静风”', enUse: 'Cloud-white paper, a large serif headline, a vertical rule, an arc and edge text; quiet and restrained',
    build(i) {
      const p = palette(i, { bg: '#ebe8e0', bg2: '#ebe8e0', ink: '#24211b', sub: '#7a7466', accent: '#8a6f4d', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2.4; const tw = wide ? inner * 0.62 : inner * 0.9; const x0 = m * 1.5;
      const size = fitTitle(i.title, tw, h * (wide ? 0.5 : 0.4), 200 * u, 36, 1.1); const th = textHeight(i.title, tw, size, 1.1); const top = h * (wide ? 0.28 : 0.26);
      const r = Math.min(w, h) * 0.42;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.09, 29),
        new Circle({ left: w - r * 1.35, top: h - r * 1.6, radius: r, fill: 'rgba(0,0,0,0)', stroke: p.accent, strokeWidth: Math.max(2, 3 * u), originX: 'left', originY: 'top', opacity: 0.5 }),
        new Circle({ left: w - r * 0.95, top: h - r * 1.2, radius: r * 0.42, fill: p.accent, originX: 'left', originY: 'top', opacity: 0.18 }),
        rule(m * 0.9, m * 0.9, h - m * 1.8, p.accent, Math.max(2, 3 * u), true, 0.7),
        sideText('QUIET NOTES — 2026 — QUIET NOTES', w - m * 0.6, m * 1.4, h - m * 2.8, Math.max(13, 16 * u), p.sub, 'down', 0.7),
        meta(i.badge?.trim() ? i.badge.trim().toUpperCase() : 'NOTES', x0, m * 0.85, inner * 0.5, Math.max(16, 20 * u), p.sub, { qcRole: 'badge' }),
        textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.1, charSpacing: -12 }),
        ...sub(i, x0, top + th + 32 * u, tw, Math.max(24, 34 * u), p.sub, { fontFamily: SERIF, fontStyle: 'italic' }),
      ) };
    },
  },
  {
    id: 'folio', zh: '编辑大标题', en: 'Editorial headline', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '纸面编辑版式：顶部粗线 + 栏目名与期号、贴左黑体大标题、宋体导语、底部细线收边；只有一个焦点，留白占一半', enUse: 'An editorial page: a heavy top rule with section and issue, a flush-left heavy headline, a serif standfirst and a hairline foot; one focal point, half the page left empty',
    build(i) {
      const p = palette(i, { bg: '#f3efe6', bg2: '#f3efe6', ink: '#191714', sub: '#5c574f', accent: '#c2410c', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.3; const inner = w - x0 * 2; const tw = wide ? inner * 0.7 : inner;
      const headY = m * 1.05; const footY = h - m * 1.05;
      // Kicker, headline and standfirst must all fit between the two rules; the headline gives way if they do not.
      const fitsAt = (sz: number): number => { const k = Math.max(26, Math.min(58 * u, sz * 0.24)); const d = Math.max(26, sz * 0.3); return k * 2.6 + textHeight(i.title, tw, sz, 1.08) + (i.subtitle.trim() ? textHeight(i.subtitle, tw * 0.92, d, 1.35) + 52 * u : 0) + m * 0.5; };
      let size = fitTitle(i.title, tw, (footY - headY) * (wide ? 0.6 : 0.46), 230 * u, 40, 1.08); for (let k = 0; k < 14 && size > 40 && fitsAt(size) > footY - headY; k++) size = Math.max(40, size * 0.92);
      const th = textHeight(i.title, tw, size, 1.08);
      const ks = Math.max(26, Math.min(58 * u, size * 0.24)); const dek = Math.max(26, size * 0.3); const dekH = i.subtitle.trim() ? textHeight(i.subtitle, tw * 0.92, dek, 1.35) + 52 * u : 0;
      // The block sits a little above the middle of the space between the rules: optical centre, not geometric.
      const room = footY - headY - ks * 2.6; const top = headY + ks * 2.6 + Math.max(m * 0.4, (room - th - dekH) * 0.42);
      const kicker = i.badge?.trim() || (i.zh ? '编辑部' : 'EDITORIAL');
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.06, 11),
        rule(x0, headY, inner, p.ink, Math.max(3, 4 * u), false, 1),
        textbox(kicker, x0, headY + ks * 0.7, inner * 0.6, { qcRole: 'badge', fontSize: ks, fill: p.accent, fontWeight: 'bold', charSpacing: hasCjk(kicker) ? 80 : 200, lineHeight: 1 }),
        textbox(`No. ${digits(i, false).padStart(2, '0')}`, x0 + inner * 0.5, headY + ks * 0.55, inner * 0.5, { fontSize: ks * 1.2, fill: p.ink, fontFamily: 'DM Serif Display', textAlign: 'right', lineHeight: 1 }),
        textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08, charSpacing: -20 }),
        rule(x0, top + th + 26 * u, Math.min(w * 0.12, 150 * u), p.accent, Math.max(5, 7 * u), false, 1),
        ...sub(i, x0, top + th + 52 * u, tw * 0.92, dek, p.sub, { fontFamily: '思源宋体', lineHeight: 1.35 }),
        rule(x0, footY, inner, p.ink, Math.max(1, 1.5 * u), false, 0.55),
      ) };
    },
  },
  {
    id: 'numeral', zh: '单色大数字', en: 'Big numeral', fit: [...XHS, ...VIDEO, ...BANNER], zhUse: '一个巨型数字做钩子 + 其下小标题；单一强调色，适合清单、教程、数字干货', enUse: 'One oversized numeral as the hook, a quiet headline beneath; a single accent colour for lists, tutorials and number posts',
    build(i) {
      const p = palette(i, { bg: '#eef0ea', bg2: '#eef0ea', ink: '#1f2a24', sub: '#6b756e', accent: '#3f6b55', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.3; const num = (/\d+/.exec(i.badge ?? '') ?? /\d+/.exec(i.title) ?? ['01'])[0].slice(0, 2);
      const ns = Math.min(h * (wide ? 0.74 : 0.42), wide ? (w * 0.46 - x0) / (num.length * 0.64) : w * 0.5); const tw = wide ? (w - x0 * 2) * 0.46 : w - x0 * 2;
      const size = fitTitle(i.title, tw, h * (wide ? 0.5 : 0.24), 120 * u, 34, 1.15); const th = textHeight(i.title, tw, size, 1.15);
      const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, Math.max(22, 30 * u), 1.25) + 22 * u : 0; const numTop = wide ? (h - ns * 1.13) / 2 : h * 0.12; const tx = wide ? w * 0.52 : x0; const ty = wide ? (h - th - subH) / 2 + 11 * u : numTop + ns * 1.02 + 18 * u;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.05, 17),
        textbox(num, wide ? x0 : x0, numTop, wide ? w * 0.44 : w - x0 * 2, { qcRole: 'ghost', fontSize: ns, fill: p.accent, fontWeight: 'bold', lineHeight: 1, charSpacing: -40 }),
        rule(tx, ty - 22 * u, 90 * u, p.ink, Math.max(3, 4 * u), false, 1),
        textbox(i.title, tx, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.15, charSpacing: -10 }),
        ...sub(i, tx, ty + th + 22 * u, tw, Math.max(22, 30 * u), p.sub, {}),
      ) };
    },
  },
  {
    id: 'sage', zh: '纸质卡片', en: 'Paper card', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '低饱和鼠尾草底 + 一张米白纸卡，标题落在卡片上；温和、干净、有质感', enUse: 'A muted sage ground with one warm paper card carrying the headline; gentle, clean and tactile',
    build(i) {
      const p = palette(i, { bg: '#d9e1d3', bg2: '#d9e1d3', ink: '#26302a', sub: '#6d786f', accent: '#b4572f', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const cx = m * 1.1; const cy = m * 1.1; const cw = w - cx * 2; const ch = h - cy * 2; const pad = m * 1.1;
      const tw = cw - pad * 2 - (wide ? cw * 0.2 : 0); const size = fitTitle(i.title, tw, ch * (wide ? 0.5 : 0.4), 190 * u, 36, 1.1); const th = textHeight(i.title, tw, size, 1.1);
      const top = cy + ch * (wide ? 0.3 : 0.28);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.07, 23),
        new Rect({ left: cx, top: cy, width: cw, height: ch, rx: 18 * u, ry: 18 * u, fill: '#fbf9f4', originX: 'left', originY: 'top', shadow: new Shadow({ color: 'rgba(38,48,42,0.14)', blur: 36 * u, offsetX: 0, offsetY: 14 * u }) }),
        meta(i.badge?.trim() ? i.badge.trim().toUpperCase() : 'NOTES', cx + pad, cy + pad * 0.8, cw * 0.5, Math.max(15, 19 * u), p.accent, { qcRole: 'badge' }),
        textbox(i.title, cx + pad, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.1, charSpacing: -14 }),
        ...sub(i, cx + pad, top + th + 28 * u, tw, Math.max(22, 30 * u), p.sub, {}),
      ) };
    },
  },
  {
    id: 'seal', zh: '书法印章', en: 'Ink & seal', fit: [...XHS, ...BANNER, 'vertical'], zhUse: '宣纸底 + 淡墨巨圆 + 大号衬线标题 + 红印章；纯中文短标题自动改竖排', enUse: 'Rice paper, a huge ink wash disc, a big serif headline and a red seal; short Chinese titles run vertically',
    build(i) {
      const p = palette(i, { bg: '#f1ead8', bg2: '#f1ead8', ink: '#1b1814', sub: '#5d5446', accent: '#c0392b', accentInk: '#f6efe0' });
      const { u, m, w, h, wide } = metrics(i); const flat = i.title.replace(/\s+/g, ''); const vertical = /^[㐀-鿿]{2,7}$/.test(flat); const stamp = (i.badge?.trim() || [...flat][0] || '印').slice(0, 2);
      const R = Math.min(w, h) * 0.48; const disc = new Circle({ left: w - R * 1.2, top: h - R * 1.35, radius: R, fill: 'rgba(30,24,16,0.075)', originX: 'left', originY: 'top' });
      if (vertical) {
        const chars = [...flat]; const size = Math.min((h * 0.66) / chars.length / (1.1 * FABRIC_LINE), wide ? w * 0.2 : w * 0.34); const x = wide ? w * 0.52 : (w - size * 1.3) / 2;
        return { background: solid(p.bg), objects: keep<FabricObject>(grain(w, h, 0.12, 31), disc,
          textbox(chars.join('\n'), x, m * 1.1, size * 1.3, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.1, textAlign: 'center' }),
          ...(i.subtitle.trim() ? [textbox([...i.subtitle.replace(/\s+/g, '')].slice(0, 16).join('\n'), x - size * 1.1, m * 1.5, size * 0.5, { qcRole: 'subtitle', fontSize: Math.max(22, size * 0.22), fill: p.sub, fontFamily: SERIF, lineHeight: 1.25, textAlign: 'center' })] : []),
          ...seal(x + size * 1.35, h - m * 1.2 - size * 0.8, size * 0.8, stamp, p.accent)) };
      }
      const inner = w - m * 2.2; const size = fitTitle(i.title, inner, h * (wide ? 0.55 : 0.4), 190 * u, 36, 1.1); const th = textHeight(i.title, inner, size, 1.1); const top = h * 0.2; const sealSize = Math.max(90, 150 * u);
      return { background: solid(p.bg), objects: keep<FabricObject>(grain(w, h, 0.12, 31), disc,
        textbox(i.title, m * 1.1, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.1, charSpacing: -10 }),
        rule(m * 1.1, top + th + 30 * u, 120 * u, p.ink, Math.max(2, 3 * u)),
        ...sub(i, m * 1.1, top + th + 54 * u, inner * 0.7, Math.max(26, 36 * u), p.sub, { fontFamily: SERIF }),
        ...seal(w - m * 1.3 - sealSize, h - m * 1.3 - sealSize, sealSize, stamp, p.accent)) };
    },
  },
  {
    id: 'quote', zh: '金句海报', en: 'Quote poster', fit: [...XHS, ...BANNER], zhUse: '墨黑底 + 巨型金色引号 + 衬线金句，一句话撑满一张海报', enUse: 'Ink black, a giant gold quotation mark and a serif statement; one line carries the poster',
    build(i) {
      const p = palette(i, { bg: '#121212', bg2: '#121212', ink: '#f5efe2', sub: '#b9ad94', accent: '#e8b960', accentInk: '#111111' });
      const { u, m, w, h, wide } = metrics(i); const inner = w - m * 2.2; const tw = wide ? inner * 0.8 : inner;
      const size = fitTitle(i.title, tw, h * (wide ? 0.56 : 0.46), 150 * u, 36, 1.22); const th = textHeight(i.title, tw, size, 1.22); const top = h * (wide ? 0.26 : 0.34);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.1, 47), textbox('“', -m * 0.2, -h * (wide ? 0.28 : 0.1), w, { fontSize: h * (wide ? 1.3 : 0.78), fill: p.accent, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1, opacity: 0.9 }),
        sideText('SAID · REMEMBERED · REPEATED', w - m * 0.6, m * 1.5, h - m * 3, Math.max(13, 16 * u), p.sub, 'down', 0.7),
        textbox(i.title, m * 1.1, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.22, charSpacing: -6 }),
        rule(m * 1.1, top + th + 36 * u, 90 * u, p.accent, Math.max(3, 4 * u)),
        // Wide tracking suits a Latin byline; on CJK it pulls a phrase apart, so Chinese gets a light touch.
        ...sub(i, m * 1.1, top + th + 62 * u, tw, Math.max(24, 34 * u), p.accent, { fontWeight: 'bold', charSpacing: hasCjk(i.subtitle) ? 30 : 120 }),
        // The badge sits at the foot; when a long subtitle has taken the foot it goes to the empty top-right corner instead.
        ...((): BadgeBox[] => {
          const bs = Math.max(16, 22 * u); const subEnd = top + th + 62 * u + (i.subtitle.trim() ? textHeight(i.subtitle, tw, Math.max(24, 34 * u), 1.25) : 0) + 24 * u;
          if (subEnd + bs * 2.3 <= h - m * 0.6) return badge(i.badge, m * 1.1, Math.max(h - m * 1.1 - 40 * u, subEnd), p, bs);
          return badge(i.badge, w - m * 1.8, m, p, bs, { originX: 'right' });
        })(),
      ) };
    },
  },
  {
    id: 'compare', zh: '对比', en: 'Versus', fit: [...XHS, ...VIDEO], zhUse: '斜切分屏：左边黯淡的“之前”，右边鲜亮的“之后”，中间一枚 VS；副标题写成「A | B」', enUse: 'A slanted split: dull “before” against vivid “after” with a VS burst; write the subtitle as “A | B”',
    build(i) {
      const p = palette(i, { bg: '#0f0f12', bg2: '#0f0f12', ink: '#ffffff', sub: '#d4d4d8', accent: '#ffd23f', accentInk: '#111111' });
      const { u, m, w, h, wide } = metrics(i); const parts = i.subtitle.split(/\s*[|｜]\s*|\s+vs\.?\s+/i).map(x => x.trim()).filter(Boolean);
      const [A, B] = parts.length >= 2 ? [parts[0]!, parts[1]!] : [i.zh ? '之前' : 'Before', i.zh ? '之后' : 'After']; const caption = parts.length >= 2 ? '' : i.subtitle.trim();
      const barH = h * (wide ? 0.3 : 0.2); const tw = w - m * 2; const size = fitTitle(i.title, tw, barH * 0.72, 150 * u, 36, 1.04); const th = textHeight(i.title, tw, size, 1.04);
      const slant = Math.min(w, h) * 0.07; const py = barH; const ph = h - barH;
      const dull = '#cfc9bf'; const dullInk = '#4a443a';
      const polyA = wide ? [{ x: 0, y: py }, { x: w / 2 + slant, y: py }, { x: w / 2 - slant, y: h }, { x: 0, y: h }] : [{ x: 0, y: py }, { x: w, y: py }, { x: w, y: py + ph / 2 - slant }, { x: 0, y: py + ph / 2 + slant }];
      const polyB = wide ? [{ x: w / 2 + slant, y: py }, { x: w, y: py }, { x: w, y: h }, { x: w / 2 - slant, y: h }] : [{ x: 0, y: py + ph / 2 + slant }, { x: w, y: py + ph / 2 - slant }, { x: w, y: h }, { x: 0, y: h }];
      const aBox = wide ? { x: m, y: py + ph * 0.3, w: w / 2 - slant - m * 1.4 } : { x: m, y: py + ph * 0.12, w: tw }; const bBox = wide ? { x: w / 2 + slant + m * 0.6, y: py + ph * 0.3, w: w / 2 - slant - m * 1.4 } : { x: m, y: py + ph * 0.62, w: tw };
      const lab = (txt: string, box: { x: number; y: number; w: number }, color: string, mark: string): FabricObject[] => { const sz = fitTitle(txt, box.w, ph * (wide ? 0.4 : 0.2), 130 * u, 30, 1.05); return [textbox(mark, box.x, box.y - 70 * u, box.w, { fontSize: Math.max(24, 40 * u), fill: color, fontWeight: 'bold', charSpacing: 200 }), textbox(txt, box.x, box.y, box.w, { fontSize: sz, fill: color, fontWeight: 'bold', lineHeight: 1.05, charSpacing: -14 })]; };
      return { background: solid(p.bg), objects: keep<FabricObject>(
        new Polygon(polyA, { fill: dull, originX: 'left', originY: 'top' }), ...dotGrid(m * 0.4, py + 20 * u, 12, 14, 70 * u, 6 * u, '#9a9387', 0.35),
        new Polygon(polyB, { fill: p.accent, originX: 'left', originY: 'top' }), rays(wide ? w * 0.78 : w * 0.7, wide ? h * 0.7 : py + ph * 0.8, Math.max(w, h), 16, '#ffffff', 0.18), sparkle(w - m * 1.2, py + (wide ? ph * 0.15 : ph * 0.58), 70 * u, '#111111', 10),
        grain(w, h, 0.08, 51), rect(0, 0, w, barH, '#111111'),
        ...badge(i.badge, m, m * 0.6, { ...p, accent: p.accent, accentInk: p.accentInk }, Math.max(18, 24 * u)),
        textbox(i.title, m, (barH - th) / 2 + (i.badge?.trim() ? 14 * u : 0), tw, { qcRole: 'title', fontSize: size, fill: '#ffffff', fontWeight: 'bold', lineHeight: 1.04, textAlign: 'center', charSpacing: -10 }),
        ...lab(A, aBox, dullInk, '✕  BEFORE'), ...lab(B, bBox, '#111111', '✓  AFTER'),
        burst(wide ? w / 2 : w / 2, wide ? py + ph / 2 : py + ph / 2, 92 * u, '#111111', 12, 8), textbox('VS', (wide ? w / 2 : w / 2) - 60 * u, (wide ? py + ph / 2 : py + ph / 2) - 34 * u, 120 * u, { fontSize: 62 * u, fill: p.accent, fontWeight: 'bold', textAlign: 'center', angle: 8 }),
        ...(caption ? [textbox(caption, m, h - m * 0.9 - 40 * u, tw, { qcRole: 'subtitle', fontSize: Math.max(22, 30 * u), fill: '#111111', fontWeight: 'bold', textAlign: 'center' })] : []),
      ) };
    },
  },
  {
    id: 'cinema', zh: '电影感', en: 'Cinematic', fit: [...VIDEO, ...BANNER], zhUse: '青橙调光 + 镜头光晕 + 金色取景角 + 字距拉开的衬线片名，纪录片、Vlog、深度内容', enUse: 'Teal-and-orange light, lens flare, gold viewfinder corners and a wide-tracked serif title; documentary and vlog', photo: true,
    build(i) {
      const p = palette(i, { bg: '#06141a', bg2: '#10303a', ink: '#f6ead2', sub: '#c9bda3', accent: '#e8b960', accentInk: '#111111' });
      const { u, m, w, h } = metrics(i); const bar = h * 0.13; const inner = w - m * 2;
      const size = fitTitle(i.title, inner, h * 0.3, 170 * u, 36, 1.08); const th = textHeight(i.title, inner, size, 1.08); const top = (h - th) / 2 - 18 * u;
      const flare = rect(0, h * 0.5 - 3 * u, w, Math.max(4, 6 * u), new Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: w, y2: 0 }, colorStops: [{ offset: 0, color: 'rgba(120,200,255,0)' }, { offset: 0.5, color: 'rgba(210,235,255,0.95)' }, { offset: 1, color: 'rgba(120,200,255,0)' }] }), { opacity: 0.8 });
      return { background: linear(p, 165), objects: keep<FabricObject>(
        kitGlow(w * 0.12, h * 0.25, Math.min(w, h) * 0.75, '#1fa3a8', 0.6), kitGlow(w * 0.92, h * 0.8, Math.min(w, h) * 0.7, '#ff8a3d', 0.55), kitGlow(w * 0.5, h * 0.5, Math.min(w, h) * 0.5, '#9fd8ff', 0.28), flare,
        grain(w, h, 0.16, 37),
        rect(0, 0, w, h, new Gradient({ type: 'radial', coords: { x1: w / 2, y1: h / 2, r1: Math.min(w, h) * 0.28, x2: w / 2, y2: h / 2, r2: Math.max(w, h) * 0.78 }, colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.78)' }] }), { qcRole: 'scrim' }),
        rect(0, 0, w, bar, '#000000'), rect(0, h - bar, w, bar, '#000000'), ...cropMarks(w, h, bar + m * 0.4, 38 * u, p.accent, Math.max(2, 3 * u)),
        meta((i.badge?.trim() || 'A FILM').toUpperCase(), m, bar + m * 0.5 + 26 * u, inner, Math.max(16, 20 * u), p.accent, { textAlign: 'center', qcRole: 'badge', charSpacing: 520 }),
        textbox(i.title, m, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.08, textAlign: 'center', charSpacing: 120, shadow: new Shadow({ color: 'rgba(255,170,90,0.45)', blur: 38 * u, offsetX: 0, offsetY: 0 }) }),
        rule(w / 2 - 60 * u, top + th + 24 * u, 120 * u, p.accent, Math.max(2, 3 * u)),
        ...sub(i, m, top + th + 46 * u, inner, Math.max(24, 32 * u), p.sub, { textAlign: 'center', charSpacing: 180 }),
        ...(w >= h * 1.3 ? [meta('PRESENTED BY QIAOMU', m, h - bar - m * 1.1 - 24 * u, inner * 0.5, Math.max(13, 16 * u), p.sub, { fontFamily: 'monospace' }), meta('2026 · 2.39:1', m + inner * 0.5, h - bar - m * 1.1 - 24 * u, inner * 0.5, Math.max(13, 16 * u), p.sub, { fontFamily: 'monospace', textAlign: 'right' })] : []),
      ) };
    },
  },
  {
    id: 'split', zh: '左文右图', en: 'Arch split', fit: [...VIDEO, ...BANNER, ...XHS], zhUse: '左文案右拱门：奶油底 + 橙色拱门窗 + 太阳圆 + 细线，右侧放人像或产品最好看', enUse: 'Copy on the left, an orange arch window on the right for a portrait or product; cream paper, a sun disc and fine rules',
    slot: i => { const { w, h } = metrics(i); const x = w * 0.54; return { x, y: 0, w: w - x, h, radius: 0 }; },
    build(i) {
      const p = palette(i, { bg: '#f6efe3', bg2: '#f6efe3', ink: '#1c1917', sub: '#6b5f55', accent: '#ff7a3d', accentInk: '#1c1917' }); // white on this orange is 2.6:1
      const { u, m, w, h, wide } = metrics(i); const inner = wide ? w * 0.5 - m * 1.2 : w - m * 2;
      const size = fitTitle(i.title, inner, h * (wide ? 0.5 : 0.28), 170 * u, 36, 1.06); const th = textHeight(i.title, inner, size, 1.06);
      const aw = wide ? w * 0.36 : w * 0.7; const ah = wide ? h * 0.9 : h * 0.46; const ax = wide ? w - aw - m * 0.8 : (w - aw) / 2; const ay = wide ? h - ah : h - ah;
      const ty = wide ? (h - th) / 2 - 30 * u : m * 1.2 + (i.badge?.trim() ? Math.max(58, 74 * u) : 0);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.09, 53),
        arch(ax - 22 * u, ay - 22 * u, aw + 44 * u, ah + 22 * u, 'rgba(0,0,0,0)', p.accent, Math.max(3, 4 * u)), arch(ax, ay, aw, ah, p.accent),
        new Circle({ left: ax + aw * 0.12, top: ay + aw * 0.24, radius: aw * 0.13, fill: '#fff3d6', originX: 'left', originY: 'top', opacity: 0.95 }),
        rule(m, m * 0.7, wide ? w * 0.42 : w - m * 2, p.ink, Math.max(1.5, 2 * u)), meta('NO.' + (i.badge?.trim() || '01'), m, m * 0.7 + 14 * u, 260 * u, Math.max(14, 17 * u), p.sub),
        ...badge(i.badge, m, ty - Math.max(58, 74 * u), p, Math.max(18, 24 * u)),
        textbox(i.title, m, ty, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.06, charSpacing: -16 }),
        rect(m, ty + th + 24 * u, 70 * u, Math.max(5, 6 * u), p.accent),
        ...sub(i, m, ty + th + 46 * u, inner, Math.max(26, 36 * u), p.sub),
      ) };
    },
  },
  {
    id: 'impact', zh: '油管冲击', en: 'Thumbnail punch', fit: ['youtube', 'bilibili', 'bilibili-43', 'bilibili-hd', 'wide', 'vertical'], zhUse: '深蓝放射光 + 黄字黑描边硬阴影 + 红色角标，右侧留主体位；短标题效果最好', enUse: 'Blue sunburst, yellow type with a black outline and hard shadow, a red arrow and burst badge; room for a subject on the right',
    photo: true,
    slot: i => { const { w, h, wide } = metrics(i); return wide ? { x: w * 0.6, y: 0, w: w * 0.4, h, radius: 0 } : undefined; },
    build(i) {
      const p = palette(i, { bg: '#0b1f6e', bg2: '#2b6bff', ink: '#ffe14a', sub: '#ffffff', accent: '#ef233c', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const inner = wide ? w * 0.58 - m : w - m * 2; const shown = upper(i.title);
      const size = fitTitle(shown, inner, h * (wide ? 0.62 : 0.42), 250 * u, 44, 1.02); const th = textHeight(shown, inner, size, 1.02); const subH = i.subtitle.trim() ? Math.max(54, 74 * u) : 0;
      const top = h - m * 1.1 - subH - 18 * u - th; const cx = wide ? w * 0.8 : w * 0.5; const cy = wide ? h * 0.46 : h * 0.3;
      return { background: linear(p, 160), objects: keep<FabricObject>(
        rays(cx, cy, Math.max(w, h) * 1.2, 22, '#ffffff', 0.06, 0.2), kitGlow(cx, cy, Math.min(w, h) * 0.7, '#7dd3fc', 0.5), grain(w, h, 0.06, 61),
        rect(0, h * 0.4, w, h * 0.6, new Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: 0, y2: h * 0.6 }, colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.7)' }] }), { qcRole: 'scrim' }),
        ...(i.badge?.trim() ? badge(i.badge, m, m, p, Math.max(22, 34 * u), { angle: -4 }) : []),
        textbox(shown, m, top, inner, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.02, stroke: '#000000', strokeWidth: Math.max(10, 18 * u), shadow: shadowHard(u, '#000000', 9), angle: -2, charSpacing: -10}),
        ...(i.subtitle.trim() ? [pill(i.subtitle, m, 0, '#000000', '#ffffff', Math.max(24, 34 * u), { qcRole: 'subtitle', radius: 0.16 })].map(b => { b.set({ top: h - m * 0.9 - b.height }); return b; }) : []),
      ) };
    },
  },
  {
    id: 'bili', zh: 'B 站知识区', en: 'Bilibili explainer', fit: ['bilibili', 'bilibili-43', 'bilibili-hd', 'youtube', 'wide', ...SHORT, ...XHS], zhUse: '浅灰底 + B 站粉蓝双色 + 粉色分区标签 + 黑色大标题 + 小电视画框（屏幕是图位）；知识区、科普、测评的干净信息感', enUse: 'Light grey with Bilibili pink and blue, a section tag, a bold headline and a little-TV frame whose screen takes a picture; explainers and reviews',
    slot: i => biliTv(i).screen,
    build(i) {
      // Bilibili's pink and blue, a shade deeper where they carry words: the brand hexes are under 3:1 on light grey.
      const p = palette(i, { bg: '#f4f5f7', bg2: '#f4f5f7', ink: '#18191c', sub: '#0086c0', accent: '#e8487b', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.2; const tv = biliTv(i); const x0 = m * 1.1;
      const tw = side ? tv.x - x0 - m * 0.9 : w - x0 * 2; const areaTop = m; const areaH = side ? h - m * 2 : tv.y - m * 2.2;
      const size = fitTitle(i.title, tw, areaH * (side ? 0.56 : 0.6), 200 * u, 36, 1.08); const th = textHeight(i.title, tw, size, 1.08);
      const tagS = Math.max(20, size * 0.2); const tagH = tagS * 1.3 * 1.7 + 26 * u; const subS = Math.max(24, size * 0.32); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subS, 1.25) + 26 * u : 0;
      const ty = areaTop + (areaH - tagH - th - subH) / 2 + tagH;
      const ant = (dx: number): Line => new Line([0, 0, dx, -tv.h * 0.16], { left: tv.x + tv.w / 2 + Math.min(0, dx) - (dx < 0 ? tv.w * 0.12 : -tv.w * 0.12), top: tv.y - tv.h * 0.16 + tv.sw * 0.3, stroke: p.accent, strokeWidth: tv.sw, strokeLineCap: 'round', originX: 'left', originY: 'top' });
      return { background: solid(p.bg), objects: keep<FabricObject>(
        ...dotGrid(m * 0.4, h * 0.62, 12, 8, 46 * u, 5 * u, p.sub, 0.25), grain(w, h, 0.05, 139),
        ant(-tv.w * 0.1), ant(tv.w * 0.1),
        rect(tv.x, tv.y, tv.w, tv.h, '#ffffff', { rx: tv.w * 0.12, ry: tv.w * 0.12, stroke: p.accent, strokeWidth: tv.sw, shadow: new Shadow({ color: 'rgba(251,114,153,0.25)', blur: 40 * u, offsetX: 0, offsetY: 16 * u }) }),
        kitGlow(tv.x + tv.w / 2, tv.y + tv.h / 2, tv.w * 0.36, '#bfe9fb', 0.8),
        rect(tv.x + tv.w * 0.2, tv.y + tv.h + tv.sw * 0.4, tv.sw * 1.4, tv.h * 0.07, p.accent, { rx: tv.sw * 0.7, ry: tv.sw * 0.7 }), rect(tv.x + tv.w * 0.8 - tv.sw * 1.4, tv.y + tv.h + tv.sw * 0.4, tv.sw * 1.4, tv.h * 0.07, p.accent, { rx: tv.sw * 0.7, ry: tv.sw * 0.7 }),
        pill(i.badge?.trim() || (i.zh ? '知识区' : 'EXPLAINER'), x0, ty - tagH, p.accent, p.accentInk, tagS * 1.3, { qcRole: 'badge', radius: 0.5 }),
        textbox(i.title, x0, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08 }),
        ...sub(i, x0, ty + th + 26 * u, tw, subS, p.sub, { fontWeight: 'bold' }),
      ) };
    },
  },
];
/* ---------- studio templates: formats that keep winning on Xiaohongshu, YouTube, Bilibili and WeChat, redrawn to the design rules ---------- */
const dot = (cx: number, cy: number, r: number, fill: string, extra: Record<string, unknown> = {}): Circle => new Circle({ left: cx, top: cy, radius: r, fill, originX: 'center', originY: 'center', ...extra });
/** The number a layout shows as its hook: from the label first, then (when allowed) the headline. */
const digits = (i: TemplateInput, fromTitle = true, fallback = '01'): string => (/\d+/.exec(i.badge ?? '') ?? (fromTitle ? /\d+/.exec(i.title) : null) ?? [fallback])[0].slice(0, 3);
/** Width of a line as drawn at the tracking the finish pass gives big headlines. */
const lineW = (line: string, size: number, weight = 'bold', spacing = -18): number => measure(line, size, weight) + [...line].length * size * spacing / 1000;
/** A copy of the headline drawn behind it (echo, misregistration). Same face, same wrap, no role, so it never counts as text. */
function echoOf(title: Textbox, text: string, left: number, top: number, width: number, o: TextOptions): Textbox {
  const e = textbox(text, left, top, width, o); e.set({ fontFamily: title.fontFamily, fontWeight: title.fontWeight }); return e;
}
/** Polaroid geometry, shared by the picture slot and the build. */
function polaroidFrame(i: TemplateInput): { x: number; y: number; w: number; h: number; b: number; photo: Slot } {
  const { m, w, h } = metrics(i); const side = w / h > 1.2;
  if (side) { const fh = h - m * 2.2; const b = fh * 0.05; const ps = fh - b * 4.6; const fw = ps + b * 2; const x = w - m * 1.6 - fw; const y = m * 1.1; return { x, y, w: fw, h: fh, b, photo: { x: x + b, y: y + b, w: ps, h: ps, radius: 0 } }; }
  const fw = Math.min(w * 0.64, h * 0.42); const b = fw * 0.06; const ps = fw - b * 2; const fh = b + ps + b * 3.6; const x = (w - fw) / 2; const y = m * 1.3;
  return { x, y, w: fw, h: fh, b, photo: { x: x + b, y: y + b, w: ps, h: ps, radius: 0 } };
}
/** The little-TV frame of the Bilibili layout. */
function biliTv(i: TemplateInput): { x: number; y: number; w: number; h: number; sw: number; screen: Slot } {
  const { u, m, w, h } = metrics(i); const side = w / h > 1.2;
  const tw = side ? Math.min(w * 0.38, h * 0.9) : Math.min(w * 0.7, h * 0.42); const th = tw * 0.74; const sw = Math.max(8, 14 * u);
  const x = side ? w - m * 1.3 - tw : (w - tw) / 2; const y = side ? (h - th) / 2 + h * 0.05 : h - m * 1.6 - th;
  return { x, y, w: tw, h: th, sw, screen: { x: x + sw, y: y + sw, w: tw - sw * 2, h: th - sw * 2, radius: tw * 0.08 } };
}

const STUDIO: Template[] = [
  {
    id: 'highlight', zh: '荧光标题', en: 'Highlighter', fit: [...XHS, ...VIDEO, ...SHORT, 'wechat'], zhUse: '白纸黑字 + 每行标题下一道圆头荧光笔（每行微微不同的倾斜），像在笔记上划重点；干货、观点、教程都稳', enUse: 'Black type on white with a round-ended highlighter stroke under every line, each at its own slight tilt; tips, opinions and tutorials',
    build(i) {
      const p = palette(i, { bg: '#fffdf7', bg2: '#fffdf7', ink: '#111111', sub: '#4a4a4a', accent: '#ffe14d', accentInk: '#111111' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.1; const tw = (w - x0 * 2) * (wide ? 0.8 : 1); const lh = 1.2;
      const size = fitTitle(i.title, tw, h * (wide ? 0.56 : 0.44), 210 * u, 40, lh); const lines = wrapLines(i.title, tw, size, 'bold', -18); const step = size * lh * FABRIC_LINE; const th = lines.length * step;
      const subSize = Math.max(26, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.3) + 40 * u : 0; const bs = Math.max(20, size * 0.22); const badgeH = i.badge?.trim() ? bs * 1.3 * 1.7 + 26 * u : 0;
      const top = (h - th - subH - badgeH) * 0.46 + badgeH;
      // A real highlighter: round ends, a stroke that overshoots the words a little, and every line at its own slight tilt.
      const tilt = [-0.9, 0.5, -0.4, 0.8]; const mh = size * 0.42;
      const marks = lines.map((l, k) => rect(x0 - size * 0.08, top + k * step + size * 0.64, Math.min(w - x0 * 0.6, lineW(l, size) + size * 0.18), mh, p.accent, { angle: tilt[k % 4], rx: mh * 0.45, ry: mh * 0.45, qcKind: 'mark-title' }));
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.05, 19), ...marks,
        ...badge(i.badge, x0, top - badgeH, { ...p, accent: p.ink, accentInk: p.bg }, bs),
        textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: lh, charSpacing: -18 }),
        ...sub(i, x0, top + th + 40 * u, tw, subSize, p.sub, { fontWeight: 'bold', lineHeight: 1.3 }),
      ) };
    },
  },
  {
    id: 'notes', zh: '备忘录', en: 'Notes app', fit: [...XHS, 'wechat', ...VIDEO], zhUse: '手机备忘录截图：黄色返回键 + 日期 + 黑色大标题 + 勾选清单（要点写在 points 里）；小红书“截图型”，亲切可信', enUse: 'A phone notes screenshot: yellow back button, date, bold headline and a checklist from the points; personal and trustworthy',
    build(i) {
      const p = palette(i, { bg: '#fbfaf6', bg2: '#fbfaf6', ink: '#1c1c1e', sub: '#7c7c80', accent: '#e2a300', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m; const inner = w - m * 2; const bar = Math.max(26, 44 * u); const dateS = Math.max(18, 26 * u);
      const list = (i.points ?? []).map(t => t.trim()).filter(Boolean).slice(0, 4); const twoCol = wide && list.length >= 2;
      const tw = twoCol ? inner * 0.56 : inner; const top = m * 0.8 + bar * 1.6 + dateS * 3;
      const size = fitTitle(i.title, tw, h * (wide ? 0.5 : 0.36), 190 * u, 36, 1.12); const th = textHeight(i.title, tw, size, 1.12);
      const subSize = Math.max(26, size * 0.32); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.25) + 30 * u : 0;
      const ls = Math.max(26, Math.min(46 * u, size * 0.4)); const lx = twoCol ? x0 + tw + m : x0; const lw = twoCol ? inner - tw - m : inner; const ly0 = twoCol ? top + 8 * u : top + th + subH + 44 * u;
      const rows = list.length >= 2 ? list.flatMap((t, k) => { const y = ly0 + k * ls * 2.1; return [new Circle({ left: lx, top: y + ls * 0.12, radius: ls * 0.44, fill: k === 0 ? p.accent : 'rgba(0,0,0,0)', stroke: p.accent, strokeWidth: Math.max(2, 3 * u), originX: 'left', originY: 'top' }), textbox(t, lx + ls * 1.4, y, lw - ls * 1.4, { fontSize: ls, fill: p.ink, lineHeight: 1.1 })]; }) : [];
      return { background: solid(p.bg), objects: keep<FabricObject>(
        textbox('‹ ' + (i.zh ? '备忘录' : 'Notes'), x0, m * 0.8, inner * 0.5, { fontSize: bar, fill: p.accent, fontWeight: 'bold' }),
        textbox(i.zh ? '完成' : 'Done', x0 + inner * 0.5, m * 0.8, inner * 0.5, { fontSize: bar, fill: p.accent, fontWeight: 'bold', textAlign: 'right' }),
        textbox(i.badge?.trim() || (i.zh ? '今天 · 笔记' : 'Today'), x0, m * 0.8 + bar * 1.6 + dateS * 0.8, inner, { qcRole: 'badge', fontSize: dateS, fill: p.sub, textAlign: 'center' }),
        textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.12 }),
        ...sub(i, x0, top + th + 30 * u, tw, subSize, p.sub), ...rows,
      ) };
    },
  },
  {
    id: 'chat', zh: '聊天截图', en: 'Chat bubbles', fit: [...XHS, ...VIDEO, ...SHORT], zhUse: '一问一答的聊天气泡：副标题是提问，标题是回答；对话感强，适合问答、AI、情感、职场', enUse: 'A chat exchange: the subtitle asks, the headline answers; Q&A, AI, relationships and work',
    build(i) {
      const p = palette(i, { bg: '#ededed', bg2: '#ededed', ink: '#111111', sub: '#111111', accent: '#95ec69', accentInk: '#111111' });
      const { u, m, w, h, wide } = metrics(i); const av = Math.max(56, 92 * u); const gap = 22 * u; const pad = Math.max(22, 32 * u); const head = Math.max(22, 30 * u); const barH = head * 2.6;
      const L = wide ? w * 0.16 : m; const R = wide ? w * 0.84 : w - m; const maxW = R - L - av - gap - pad * 2 - av * 0.3;
      const size = fitTitle(i.title, maxW, h * (wide ? 0.46 : 0.4), 170 * u, 36, 1.12); const aLines = wrapLines(i.title, maxW, size, 'bold', -18);
      const aW = Math.max(...aLines.map(l => lineW(l, size))) + pad * 2; const aH = aLines.length * size * 1.12 * FABRIC_LINE + pad * 1.4;
      const q = i.subtitle.trim(); const qs = Math.max(28, size * 0.34); const qLines = q ? wrapLines(q, maxW, qs, 'normal', 0) : [];
      const qW = q ? Math.max(...qLines.map(l => measure(l, qs, 'normal'))) + pad * 2 : 0; const qH = q ? qLines.length * qs * 1.25 * FABRIC_LINE + pad * 1.4 : 0;
      const between = gap * 2.4; const total = (q ? qH + between : 0) + aH; const y0 = barH + (h - barH - total) / 2; const ay = y0 + (q ? qH + between : 0);
      const tail = (x: number, y: number, fill: string, right: boolean): Triangle => new Triangle({ left: x, top: y, width: 22 * u, height: 14 * u, fill, angle: right ? 90 : -90, originX: 'center', originY: 'center' });
      const bx = R - av - gap - aW;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        rect(0, 0, w, barH, '#f7f7f7'), rule(0, barH, w, '#d4d4d4', Math.max(1, 1.5 * u)),
        textbox('‹', m * 0.7, (barH - head * 1.6 * 1.13) / 2, head * 2, { fontSize: head * 1.6, fill: p.ink, lineHeight: 1 }),
        textbox(i.badge?.trim() || (i.zh ? '对话' : 'Chat'), m * 2, (barH - head * 1.25 * 1.13) / 2, w - m * 4, { qcRole: 'badge', fontSize: head, fill: p.ink, fontWeight: 'bold', textAlign: 'center' }),
        ...(q ? [rect(L, y0, av, av, '#8fb3dc', { rx: 10 * u, ry: 10 * u }), rect(L + av + gap, y0, qW, qH, '#ffffff', { rx: 14 * u, ry: 14 * u }), tail(L + av + gap - 6 * u, y0 + Math.min(av, qH) / 2, '#ffffff', false),
          textbox(q, L + av + gap + pad, y0 + pad * 0.7, qW - pad * 2 + 6, { qcRole: 'subtitle', fontSize: qs, fill: p.sub })] : []),
        rect(R - av, ay, av, av, '#f5a04a', { rx: 10 * u, ry: 10 * u }), rect(bx, ay, aW, aH, p.accent, { rx: 14 * u, ry: 14 * u }), tail(bx + aW + 6 * u, ay + Math.min(av, aH) / 2, p.accent, true),
        textbox(i.title, bx + pad, ay + pad * 0.7, aW - pad * 2 + 6, { qcRole: 'title', fontSize: size, fill: p.accentInk, fontWeight: 'bold', lineHeight: 1.12, charSpacing: -18 }),
      ) };
    },
  },
  {
    id: 'keyword', zh: '一词冲击', en: 'Keyword punch', fit: ['youtube', 'bilibili', 'bilibili-43', 'bilibili-hd', 'wide', ...SHORT, ...XHS], zhUse: '缩略图式三词标题：饱和蓝底 + 超粗白字 + 一块黄色关键词标签（副标题）+ 主体位上一枚浅色圆盘（有图时主体站在上面）；不靠描边和爆炸星也抢眼', enUse: 'A three-word thumbnail: saturated blue, heavy white type, one yellow keyword tag (the subtitle) and a pale disc where the subject stands; loud without outlines or bursts',
    photo: true,
    slot: i => { const { w, h } = metrics(i); return w / h > 1.2 ? { x: w * 0.56, y: 0, w: w * 0.44, h, radius: 0 } : { x: 0, y: h * 0.5, w, h: h * 0.5, radius: 0 }; },
    build(i) {
      const p = palette(i, { bg: '#1740ff', bg2: '#1740ff', ink: '#ffffff', sub: '#111111', accent: '#ffd400', accentInk: '#111111' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.2; const x0 = m * 1.1; const tw = side ? w * 0.56 - x0 : w - x0 * 2; const shown = upper(i.title);
      // Label, tag and headline are one stack: the headline is sized so the whole stack fits, or the layout pass would push it onto the tag.
      const stackOf = (sz: number): number => { const ts = Math.max(28, sz * 0.32); const tg = i.subtitle.trim() ? ts * 1.8 + 30 * u + Math.min(tw, lineW(i.subtitle.trim(), ts, 'bold', 0) + ts * 1.2) * 0.035 : 0; const bd = i.badge?.trim() ? Math.max(20, sz * 0.18) * 2.2 + 34 * u + tw * 0.035 : 0; return textHeight(shown, tw, sz, 1.0) + tg + bd; };
      let size = fitTitle(shown, tw, h * (side ? 0.56 : 0.36), 280 * u, 44, 1.0); for (let k = 0; k < 14 && size > 44 && stackOf(size) > h - m * 2.2; k++) size = Math.max(44, size * 0.92);
      const th = textHeight(shown, tw, size, 1.0);
      const tagS = Math.max(28, size * 0.32); const tagW = i.subtitle.trim() ? Math.min(tw, lineW(i.subtitle.trim(), tagS, 'bold', 0) + tagS * 1.2) : 0; const tagH = i.subtitle.trim() ? tagS * 1.8 + 30 * u + tagW * Math.sin(2 * Math.PI / 180) : 0; /* tilted 2°: its left end drops toward the headline */ const bs = Math.max(20, size * 0.18); const badgeH = i.badge?.trim() ? bs * 1.3 * 1.7 + 34 * u + tw * Math.sin(2 * Math.PI / 180) : 0; // the tag is tilted 2°: its right end rises toward the badge
      const top = side ? Math.max(m + badgeH + tagH, (h - th - tagH) / 2 + tagH) : m * 1.2 + badgeH + tagH;
      // Where the subject goes: a pale disc and a ring. Empty, it balances the type; with a picture, the subject stands on it.
      const dr = side ? h * 0.4 : w * 0.36; const dx = side ? w * 0.78 : w * 0.5; const dy = side ? h * 0.54 : h * 0.76;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.06, 89),
        dot(dx, dy, dr, '#ffffff', { opacity: 0.12, qcKind: 'mark' }), dot(dx, dy, dr * 1.18, 'rgba(0,0,0,0)', { stroke: '#ffffff', strokeWidth: Math.max(2, 3 * u), opacity: 0.22, qcKind: 'mark' }),
        ...badge(i.badge, x0, m, { ...p, accent: '#ffffff', accentInk: p.bg }, bs),
        ...(i.subtitle.trim() ? [pill(i.subtitle, x0, top - tagH, p.accent, p.accentInk, tagS, { qcRole: 'subtitle', radius: 0.14, angle: -2 })] : []),
        textbox(shown, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.0, charSpacing: -18, shadow: new Shadow({ color: 'rgba(0,0,40,0.35)', blur: 26 * u, offsetX: 0, offsetY: 8 * u }) }),
      ) };
    },
  },
  {
    id: 'riso', zh: '孔版印刷', en: 'Risograph', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '再生纸 + 荧光粉与蓝两种专色叠印 + 轻微错版 + 颗粒；独立杂志、展览、文艺与潮流话题', enUse: 'Recycled paper, fluorescent pink and blue overprinting with slight misregistration and grain; zines, shows and culture',
    build(i) {
      const p = palette(i, { bg: '#f3eee4', bg2: '#f3eee4', ink: '#1f4fd1', sub: '#1f4fd1', accent: '#ff4fa3', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.2; const x0 = m * 1.1;
      const R = Math.min(w, h) * (side ? 0.4 : 0.34); const cx = side ? w * 0.8 : w * 0.64; const cy = side ? h * 0.4 : h * 0.27;
      // Side by side, the words stop before the blue block: overprinting is the look, but blue type on blue ink cannot be read.
      const tw = side ? Math.min((w - x0 * 2) * 0.64, cx - R * 1.3 - x0 - m * 0.4) : w - x0 * 2;
      const size = fitTitle(i.title, tw, h * (side ? 0.56 : 0.34), 220 * u, 40, 1.02); const th = textHeight(i.title, tw, size, 1.02);
      const subSize = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.25) + 26 * u : 0;
      const top = h - m * 1.1 - subH - th; const off = Math.max(4, 7 * u); const mul = { globalCompositeOperation: 'multiply' };
      const title = textbox(i.title, x0, top, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.02, charSpacing: -18 }); title.set(mul);
      const echo = echoOf(title, i.title, x0 + off, top + off * 0.6, tw, { fontSize: size, fill: p.accent, fontWeight: 'bold', lineHeight: 1.02, charSpacing: -18, opacity: 0.9 }); echo.set(mul);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        dot(cx, cy, R, p.accent, { opacity: 0.92, ...mul }), rect(cx - R * 1.3, cy - R * 0.2, R * 1.05, R * 1.05, p.ink, { opacity: 0.82, ...mul }),
        ...dotGrid(cx + R * 0.1, cy + R * 0.25, 9, 7, R * 0.16, R * 0.035, p.ink, 0.55),
        grain(w, h, 0.14, 97),
        meta(`RISO · NO.${digits(i, false)}`, x0, m * 0.9, w * 0.5, Math.max(15, 19 * u), p.ink, { opacity: 0.85 }),
        ...badge(i.badge, x0, m * 0.9 + Math.max(15, 19 * u) * 2.2, p, Math.max(18, 24 * u)),
        echo, title,
        ...sub(i, x0, top + th + 26 * u, tw, subSize, p.sub, { fontWeight: 'bold' }),
      ) };
    },
  },
  {
    id: 'ticket', zh: '票根', en: 'Ticket stub', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '一张带缺口和齿孔的入场券：主券写标题，存根放标签与条码；活动、课程、展览、旅行', enUse: 'An admission ticket with notches and perforation: headline on the main part, label and barcode on the stub; events, courses, travel',
    build(i) {
      const p = palette(i, { bg: '#ff6a3d', bg2: '#ff6a3d', ink: '#1f1a17', sub: '#6b6158', accent: '#ff6a3d', accentInk: '#fff6ea' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.05; const card = '#fff6ea';
      const cx = m, cy = side ? m : m * 1.3; const cw = w - m * 2, ch = h - cy * 2; const stub = side ? cw * 0.26 : ch * 0.24;
      const mainW = side ? cw - stub : cw; const mainH = side ? ch : ch - stub; const pad = Math.max(m * 0.75, 36 * u); const tw = mainW - pad * 2; const metaS = Math.max(15, 20 * u);
      const size = fitTitle(i.title, tw, mainH * 0.5, 190 * u, 36, 1.06); const th = textHeight(i.title, tw, size, 1.06);
      const subSize = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.25) + 24 * u : 0;
      const head = metaS * 2.8; const ty = cy + pad + head + (mainH - pad * 2 - head - th - subH) * 0.5;
      const nr = Math.max(18, 30 * u); const px = side ? cx + mainW : cx; const py = side ? cy : cy + mainH;
      const dash = { stroke: p.ink, strokeWidth: Math.max(2, 3 * u), strokeDashArray: [12 * u, 10 * u], opacity: 0.35, originX: 'left' as const, originY: 'top' as const };
      const perf = side ? new Line([0, 0, 0, ch - nr * 2.6], { left: px, top: cy + nr * 1.3, ...dash }) : new Line([0, 0, cw - nr * 2.6, 0], { left: cx + nr * 1.3, top: py, ...dash });
      const notch = side ? [dot(px, cy, nr, p.bg), dot(px, cy + ch, nr, p.bg)] : [dot(cx, py, nr, p.bg), dot(cx + cw, py, nr, p.bg)];
      const label = i.badge?.trim() || (i.zh ? '入场券' : 'ADMIT ONE'); const sx = side ? px : cx, sy = side ? cy : py, sw = side ? stub : cw, sh = side ? ch : stub;
      const ls = side ? fitTitle(label, sw - pad * 1.4, sh * 0.34, 110 * u, 24, 1.05) : fitTitle(label, sw * 0.5, sh * 0.6, 110 * u, 24, 1.05);
      const bw = side ? Math.min(sw - pad * 1.4, 240 * u) : Math.min(sw * 0.34, 300 * u); const bh = side ? Math.min(sh * 0.2, 80 * u) : Math.min(sh * 0.42, 90 * u);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.08, 101),
        rect(cx, cy, cw, ch, card, { rx: 22 * u, ry: 22 * u, shadow: new Shadow({ color: 'rgba(80,20,0,0.25)', blur: 40 * u, offsetX: 0, offsetY: 16 * u }) }),
        ...notch, perf,
        meta(i.zh ? 'ADMIT ONE · 入场' : 'ADMIT ONE', cx + pad, cy + pad, tw * 0.6, metaS, p.sub),
        meta(`NO.${digits(i, false, '0001').padStart(4, '0')}`, cx + pad + tw * 0.5, cy + pad, tw * 0.5, metaS, p.sub, { textAlign: 'right' }),
        rule(cx + pad, cy + pad + metaS * 1.9, tw, p.ink, Math.max(1.5, 2 * u), false, 0.6),
        textbox(i.title, cx + pad, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.06 }),
        ...sub(i, cx + pad, ty + th + 24 * u, tw, subSize, p.sub),
        textbox(label, side ? sx + pad * 0.7 : sx + pad, side ? sy + sh * 0.18 : sy + (sh - ls * 1.19) / 2, side ? sw - pad * 1.4 : sw * 0.5, { qcRole: 'badge', fontSize: ls, fill: toContrast(p.accent, card), fontWeight: 'bold', lineHeight: 1.05, textAlign: side ? 'center' : 'left' }),
        ...barcode(side ? sx + (sw - bw) / 2 : sx + sw - pad - bw, side ? sy + sh - pad - bh : sy + (sh - bh) / 2, bw, bh, p.ink, 9),
      ) };
    },
  },
  {
    id: 'window', zh: '窗口教程', en: 'App window', fit: [...VIDEO, ...XHS, ...BANNER], zhUse: '柔和渐变底上一扇 macOS 风格窗口：红黄绿三点 + 文件名标签 + 窗口里的大标题；教程、工具、编程、效率', enUse: 'A macOS-style window on a soft gradient: traffic lights, a file tab and the headline inside; tutorials, tools and code',
    build(i) {
      const p = palette(i, { bg: '#dfe3fb', bg2: '#dfe3fb', ink: '#111827', sub: '#4b5563', accent: '#6366f1', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const cx = m * (wide ? 1.4 : 0.9); const cw = w - cx * 2; const ch = h * (wide ? 0.76 : 0.6); const cy = (h - ch) / 2;
      const bar = Math.max(44, 66 * u); const pad = Math.max(m * 0.9, 48 * u); const tw = cw - pad * 2; const r = Math.max(14, 24 * u);
      const size = fitTitle(i.title, tw, (ch - bar) * 0.52, 180 * u, 36, 1.08); const th = textHeight(i.title, tw, size, 1.08);
      const subSize = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.25) + 28 * u : 0; const kick = Math.max(6, 9 * u) + 30 * u;
      const ty = cy + bar + (ch - bar - th - subH - kick) / 2 + kick;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        ...dotGrid(w - m * 0.5 - 7 * 34 * u, m * 0.5, 8, 5, 34 * u, 4 * u, p.accent, 0.4, false), grain(w, h, 0.06, 103),
        rect(cx, cy, cw, ch, '#ffffff', { rx: r, ry: r, shadow: new Shadow({ color: 'rgba(49,46,129,0.22)', blur: 60 * u, offsetX: 0, offsetY: 24 * u }) }),
        rect(cx, cy, cw, bar, '#f3f4f6', { rx: r, ry: r }), rect(cx, cy + bar / 2, cw, bar / 2, '#f3f4f6'), rule(cx, cy + bar, cw, '#e5e7eb', Math.max(1, 2 * u)),
        dot(cx + bar * 0.55, cy + bar / 2, bar * 0.13, '#ff5f57'), dot(cx + bar * 0.95, cy + bar / 2, bar * 0.13, '#febc2e'), dot(cx + bar * 1.35, cy + bar / 2, bar * 0.13, '#28c840'),
        textbox(i.badge?.trim() || 'cover.md', cx + bar * 2, cy + (bar - bar * 0.36 * 1.13) / 2, cw - bar * 4, { qcRole: 'badge', fontSize: bar * 0.36, fill: '#6b7280', textAlign: 'center', fontFamily: 'monospace', lineHeight: 1 }),
        rect(cx + pad, ty - kick, Math.max(40, 64 * u), Math.max(6, 9 * u), p.accent, { rx: 4 * u, ry: 4 * u }),
        textbox(i.title, cx + pad, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08 }),
        ...sub(i, cx + pad, ty + th + 28 * u, tw, subSize, p.sub),
      ) };
    },
  },
  {
    id: 'newspaper', zh: '报纸头版', en: 'Front page', fit: [...BANNER, ...XHS, ...VIDEO], zhUse: '新闻纸 + 衬线报头（标签做报名）+ 双线 + 期号栏 + 分栏灰条；把观点做成“头版头条”，评论、深度、年度盘点', enUse: 'Newsprint, a serif masthead (the label), double rules, a dateline and greeked columns; opinion, analysis, annual reviews',
    build(i) {
      const p = palette(i, { bg: '#efeadf', bg2: '#efeadf', ink: '#141210', sub: '#4d4740', accent: '#b3261e', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.2; const x0 = m; const inner = w - m * 2;
      const mast = i.badge?.trim() || (i.zh ? '封面日报' : 'The Cover Daily');
      const ms = Math.min(side ? h * 0.12 : h * 0.075, inner * 0.9 / Math.max(3, [...mast].length * (hasCjk(mast) ? 1.05 : 0.55)));
      const my = m * 0.6; const ry = my + ms * 1.2 + 8 * u; const ds = Math.max(13, 17 * u); const dl = ry + 16 * u; const hy = dl + ds * 2.4 + 26 * u;
      const tw = side ? inner * 0.6 : inner; const size = fitTitle(i.title, tw, (h - hy - m) * (side ? 0.7 : 0.42), 200 * u, 36, 1.06); const th = textHeight(i.title, tw, size, 1.06);
      const subSize = Math.max(22, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.25) + 26 * u : 0;
      const colX = side ? x0 + tw + m * 0.7 : x0; const colW = side ? w - m - colX : inner; const colY = side ? hy + 6 * u : hy + th + subH + 34 * u; const ncol = side ? 2 : 3; const cg = 26 * u; const cwid = (colW - cg * (ncol - 1)) / ncol;
      const lg = Math.max(14, 22 * u); const bars: FabricObject[] = [];
      for (let c = 0; c < ncol; c++) for (let k = 0; colY + k * lg + lg < h - m && k < 40; k++) { const end = (k + c * 3) % 9 === 8; bars.push(rect(colX + c * (cwid + cg), colY + k * lg, cwid * (end ? 0.55 : 0.88 + ((k * 7 + c * 5) % 5) * 0.03), lg * 0.34, p.ink, { opacity: 0.16 })); }
      if (!side) for (let c = 1; c < ncol; c++) bars.push(rule(colX + c * (cwid + cg) - cg / 2, colY, h - m - colY, p.ink, 1, true, 0.25)); else bars.push(rule(colX - m * 0.35, hy, h - m - hy, p.ink, 1, true, 0.35));
      const dlText = (t: string, x: number, align: string): Textbox => meta(t, x, dl, inner / 3, ds, p.ink, { textAlign: align });
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.12, 107),
        textbox(mast, x0, my, inner, { qcRole: 'badge', fontSize: ms, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', textAlign: 'center', lineHeight: 1 }),
        rule(x0, ry, inner, p.ink, Math.max(3, 4 * u)), rule(x0, ry + 8 * u, inner, p.ink, Math.max(1, 1.5 * u)),
        dlText('VOL. 2026', x0, 'left'), dlText(i.zh ? '特 刊' : 'SPECIAL EDITION', x0 + inner / 3, 'center'), dlText(`NO. ${digits(i, false)}`, x0 + inner * 2 / 3, 'right'),
        rule(x0, dl + ds * 1.7, inner, p.ink, Math.max(1, 1.5 * u)),
        textbox(i.title, x0, hy, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontFamily: SERIF, fontWeight: 'bold', lineHeight: 1.06 }),
        ...sub(i, x0, hy + th + 26 * u, tw, subSize, p.accent, { fontFamily: SERIF, fontWeight: 'bold' }),
        ...bars,
      ) };
    },
  },
  {
    id: 'polaroid', zh: '拍立得', en: 'Polaroid', fit: [...XHS, ...VIDEO, 'wechat'], zhUse: '一张贴着胶带的拍立得相纸（相纸里是图位）+ 标签写在相纸下沿 + 旁边大标题；旅行、Vlog、生活记录', enUse: 'A taped instant photo (the print is a picture slot), the label on its lip and a big headline beside it; travel, vlogs, everyday life',
    slot: i => polaroidFrame(i).photo,
    build(i) {
      const p = palette(i, { bg: '#e7e0d3', bg2: '#e7e0d3', ink: '#2a241d', sub: '#6e6457', accent: '#d9653b', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.2; const f = polaroidFrame(i); const ph = f.photo;
      const x0 = side ? m * 1.2 : m; const tw = side ? f.x - m * 2.2 : w - m * 2; const areaTop = side ? m : f.y + f.h + 40 * u; const areaH = side ? h - m * 2 : h - areaTop - m;
      const size = fitTitle(i.title, tw, areaH * (side ? 0.6 : 0.62), 180 * u, 36, 1.08); const th = textHeight(i.title, tw, size, 1.08);
      const subSize = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subSize, 1.25) + 24 * u : 0; const ty = areaTop + (areaH - th - subH) / 2;
      const cap = i.badge?.trim(); const capS = Math.max(20, f.b * 1.1);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.1, 109),
        new Rect({ left: f.x + f.w / 2, top: f.y + f.h / 2, width: f.w, height: f.h, fill: '#f8f6f0', angle: -6, originX: 'center', originY: 'center', shadow: new Shadow({ color: 'rgba(40,25,10,0.18)', blur: 24 * u, offsetX: 0, offsetY: 8 * u }) }),
        rect(f.x, f.y, f.w, f.h, '#fdfcf8', { shadow: new Shadow({ color: 'rgba(40,25,10,0.26)', blur: 30 * u, offsetX: 0, offsetY: 12 * u }) }),
        rect(ph.x, ph.y, ph.w, ph.h, gradient(ph.w, ph.h, '#f4c99b', '#7f9bb5', 170)), kitGlow(ph.x + ph.w * 0.7, ph.y + ph.h * 0.42, ph.w * 0.32, '#fff3d6', 0.9),
        tape(f.x + f.w / 2 - 80 * u, f.y - 22 * u, 160 * u, 44 * u, -4),
        cap ? textbox(cap, f.x + f.b, ph.y + ph.h + (f.h - ph.h - f.b - capS * 1.3) / 2, f.w - f.b * 2, { qcRole: 'badge', fontSize: capS, fill: p.sub, fontFamily: SERIF, textAlign: 'center', lineHeight: 1.1 }) : undefined,
        textbox(i.title, x0, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08, textAlign: side ? 'left' : 'center' }),
        ...sub(i, x0, ty + th + 24 * u, tw, subSize, p.sub, { textAlign: side ? 'left' : 'center' }),
      ) };
    },
  },
  {
    id: 'stack', zh: '叠字海报', en: 'Echo stack', fit: [...XHS, ...SHORT, ...BANNER], zhUse: '同一句标题上下重复、逐层变淡，中间一行是红色实字；字体海报的节奏感，适合短标题、口号、金句', enUse: 'The headline repeated in fading layers around one solid red line; a rhythmic type poster for short titles and slogans',
    build(i) {
      const p = palette(i, { bg: '#ece6da', bg2: '#ece6da', ink: '#16130f', sub: '#5f574c', accent: '#e8432b', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m; const tw = w - m * 2; const lh = 0.98;
      const subSize = Math.max(24, 34 * u); const reserve = (i.subtitle.trim() ? subSize * 1.5 + 40 * u : 0) + (i.badge?.trim() ? 70 * u : 0) + m * 2;
      const one = Math.min(260 * u, h * (wide ? 0.17 : 0.11), (tw * 100) / Math.max(1, lineW(i.title, 100)) * 0.98);
      const size = one >= 60 * u ? one : fitTitle(i.title, tw, h * 0.22, 160 * u, 32, lh); const rows = wrapLines(i.title, tw, size, 'bold', -18).length; const block = rows * size * lh * FABRIC_LINE + (rows > 1 ? size * 0.4 : 0);
      let n = Math.max(3, Math.min(9, Math.floor((h - reserve) / block))); if (n % 2 === 0) n--; const mid = (n - 1) / 2;
      const y0 = m + (i.badge?.trim() ? 70 * u : 0) + (h - reserve - n * block) / 2;
      const title = textbox(i.title, x0, y0 + mid * block, tw, { qcRole: 'title', fontSize: size, fill: p.accent, fontWeight: 'bold', lineHeight: lh, charSpacing: -18, textAlign: 'center' });
      const echoes = Array.from({ length: n }, (_, k) => k).filter(k => k !== mid).map(k => echoOf(title, i.title, x0, y0 + k * block, tw, { fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: lh, charSpacing: -18, textAlign: 'center', opacity: 0.08 + 0.5 * (1 - Math.abs(k - mid) / (mid + 1)) ** 2 }));
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.08, 113), ...echoes, title,
        ...badge(i.badge, 0, m * 0.9, { ...p, accent: p.ink, accentInk: p.bg }, Math.max(18, 24 * u)).map(b => { b.set({ left: w / 2 - b.width / 2 }); return b; }),
        ...sub(i, x0, Math.min(h - m - subSize * 1.3, y0 + n * block + 30 * u), tw, subSize, p.sub, { textAlign: 'center', fontWeight: 'bold' }),
      ) };
    },
  },
  {
    id: 'serial', zh: '栏目头图', en: 'Column header', fit: [...BANNER, ...VIDEO, ...XHS], zhUse: '深绿栏目条（栏目名 + 大期号，标签写“周刊 12”）+ 标题；公众号系列文章、周刊、播客的固定头图，转发裁成方图时标题仍在中间', enUse: 'A dark column band with the series name and a big issue number (label like “Weekly 12”) beside the headline; recurring newsletters and podcasts',
    build(i) {
      const p = palette(i, { bg: '#f4f1ea', bg2: '#f4f1ea', ink: '#1a1a1a', sub: '#6b6560', accent: '#1f4d3a', accentInk: '#f4f1ea' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.25; const num = digits(i, false).padStart(2, '0');
      const name = (i.badge?.trim() ?? '').replace(/\d+/g, '').replace(/[#№.·\s-]+$/, '').trim() || (i.zh ? '深度专栏' : 'COLUMN');
      const bw = side ? w * 0.3 : w; const bh = side ? h : h * 0.36; const ms = Math.max(16, 22 * u); const bp = m * 0.9;
      const ns = side ? Math.min(h * 0.5, (bw - bp * 2) / (num.length * 0.62)) : Math.min(bh * 0.52, (bw - bp * 2) / (num.length * 0.62));
      const cx = side ? bw + m * 1.2 : m; const cw = side ? w - cx - m : w - m * 2; const cTop = side ? m : bh + m; const cH = side ? h - m * 2 : h - bh - m * 2;
      const size = fitTitle(i.title, cw, cH * 0.66, 180 * u, 36, 1.08); const th = textHeight(i.title, cw, size, 1.08);
      const subSize = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, cw, subSize, 1.25) + 26 * u : 0; const kick = 34 * u; const ty = cTop + (cH - th - subH - kick) / 2 + kick;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.07, 127), rect(0, 0, bw, bh, p.accent), grain(bw, bh, 0.1, 131),
        textbox(name, bp, bp, bw - bp * 2, { qcRole: 'badge', fontSize: Math.max(30, 54 * u), fill: p.accentInk, fontWeight: 'bold', lineHeight: 1.1 }),
        meta('NO.', bp, bh - bp - ns * 1.02 - ms * 1.6, bw * 0.5, ms, p.accentInk, { opacity: 0.7 }),
        textbox(num, bp, bh - bp - ns * 1.02, bw - bp * 2, { fontSize: ns, fill: p.accentInk, fontWeight: 'bold', lineHeight: 0.9, charSpacing: -30 }),
        rect(cx, ty - kick, Math.max(40, 64 * u), Math.max(5, 7 * u), p.accent),
        textbox(i.title, cx, ty, cw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08 }),
        ...sub(i, cx, ty + th + 26 * u, cw, subSize, p.sub),
      ) };
    },
  },

];

// Premium styles first; the three plainest classics (editorial, centred label, old sticker) are superseded by these.
const RETIRED = new Set(['editorial', 'center', 'sticker', 'dark', 'gradient', 'checklist', 'soft', 'compare', 'split', 'impact', 'bili']);
for (let k = TEMPLATES.length - 1; k >= 0; k--) if (RETIRED.has(TEMPLATES[k]!.id)) TEMPLATES.splice(k, 1);
const MOODY = new Set(['neon', 'cinema', 'quote']); // dark by nature: still available, but never the first thing a new user sees
TEMPLATES.unshift(...GAODING, ...STUDIO.filter(t => !MOODY.has(t.id)), ...PREMIUM.filter(t => !MOODY.has(t.id)), ...PREMIUM.filter(t => MOODY.has(t.id)), ...STUDIO.filter(t => MOODY.has(t.id)));
// The first screen of the gallery alternates quiet and loud, paper and colour, so the range is visible without scrolling.
const LEAD = ['folio', 'brush', 'keyword', 'regeng', 'highlight', 'frame', 'sage', 'notes', 'interview', 'riso', 'kicker', 'numeral', 'calendar', 'ticket', 'corner', 'polaroid', 'serial', 'chat', 'window', 'newspaper', 'stack', 'bili', 'pop'];
// Looks built on mesh gradients and soft glows read as generic in a feed, so they are offered last.
const GRADIENT_LED = new Set(['acid', 'glass']); TEMPLATES.sort((x, y) => (LEAD.indexOf(x.id) + 1 || (GRADIENT_LED.has(x.id) ? 199 : 99)) - (LEAD.indexOf(y.id) + 1 || (GRADIENT_LED.has(y.id) ? 199 : 99)));

/**
 * Typographic finish applied to every template, so the system is consistent rather than each layout inventing its own rules:
 * tighter tracking on big CJK headlines, and for the left-aligned "text block" layouts the subtitle sits right under the
 * headline and the block is optically centred (a little above the middle) instead of leaving the subtitle at the page foot.
 */
const STACKED = new Set(['minimal', 'dark', 'gradient', 'split', 'soft']);
/** Layouts whose text is a plain block that can be re-stacked without breaking anything attached to it (stickers, rules, frames). */
export const canReflow = (id: string | undefined): boolean => !!id && (STACKED.has(id) || ['bold', 'poster', 'impact', 'photo', 'bili', 'number', 'compare', 'neo'].includes(id));
for (const t of TEMPLATES) {
  const raw = t.build.bind(t);
  t.build = (i: TemplateInput): TemplateResult => {
    const r = raw(i);
    const texts = r.objects.filter((o): o is Textbox & RoleBox => o instanceof Textbox);
    const title = texts.find(x => x.qcRole === 'title'), sub = texts.find(x => x.qcRole === 'subtitle' && !(x instanceof BadgeBox)), tag = texts.find(x => x.qcRole === 'badge');
    if (title && hasCjk(title.text) && title.fontSize >= 64) title.set({ charSpacing: -18 });
    // A pill cannot wrap: one that would run past the far margin gets a smaller size instead of leaving the canvas.
    for (const b of texts) if (b instanceof BadgeBox && b.originX === 'left' && Math.abs(b.angle ?? 0) < 10) {
      const room = i.width - b.left * 2; if (room > 0 && b.width > room) { b.set({ fontSize: b.fontSize * room / b.width }); b.initDimensions(); b.setCoords(); }
    }
    // A subtitle has to be readable at thumbnail size: never smaller than about a third of the headline.
    if (title && sub && !sub.angle && t.id !== 'print' && sub.fontSize < title.fontSize * 0.3) {
      sub.set({ fontSize: Math.min(title.fontSize * 0.3, sub.fontSize * 2.6) });
      // At the new size the line may no longer fit: wrap it with the CJK-aware rules, not Fabric's per-character split (which starts lines with "；").
      if (hasCjk(sub.text)) { (sub as Wrapped).qcWrapped = true; sub.set({ splitByGrapheme: false }); rewrap(sub); }
    }
    if (STACKED.has(t.id)) tightenCopy(r.objects, i.width, i.height, 0.47);
    // The subtitle must never sit on the headline: when they overlap, drop it just below.
    // A label must not sit on the headline: push the headline below it when they collide.
    if (title && tag && tag.top + tag.getScaledHeight() > title.top && tag.top < title.top + title.getScaledHeight() && tag.left < title.left + title.getScaledWidth() && tag.left + tag.getScaledWidth() > title.left) {
      const lowest = tag.top + tag.getScaledHeight() + tag.fontSize * 0.5; const room = i.height - title.getScaledHeight() - 12; title.set({ top: Math.min(room, Math.max(title.top, lowest)) }); title.setCoords();
    }
    // (after the label rule, which can move the headline) a subtitle never sits inside the headline
    if (title && sub && sub.top < title.top + title.getScaledHeight() && sub.top + sub.getScaledHeight() > title.top && sub.left < title.left + title.getScaledWidth() && sub.left + sub.getScaledWidth() > title.left && !sub.angle && !title.angle) {
      const next = title.top + title.getScaledHeight() + title.fontSize * 0.18; if (next + sub.getScaledHeight() < i.height - 8) { sub.set({ top: next }); sub.setCoords(); }
    }
    return r;
  };
}

/** Templates ordered so those designed for `platformId` come first. */
// Dark, loud looks (sunburst punch, neon, letterbox): still resolvable for old covers, never offered in the gallery.
const HIDDEN = new Set(['impact', 'neon', 'cinema', 'quote', 'compare', 'ticker']);
export function templatesFor(platformId: string | undefined): Template[] {
  return TEMPLATES.filter(t => !HIDDEN.has(t.id)).sort((a, b) => Number(b.fit.includes(platformId ?? '')) - Number(a.fit.includes(platformId ?? '')));
}

type RoleBox = FabricObject & { qcRole?: string };
/**
 * Proximity and optical centring for wide covers: when a left-aligned subtitle sits far below its headline, pull it up under
 * the headline and centre the whole text block vertically. Leaves layouts with other text, centred type or tall canvases alone.
 */
export function tightenCopy(objects: FabricObject[], width: number, height: number, centre = 0.5): void {
  const texts = objects.filter((o): o is Textbox & RoleBox => o instanceof Textbox);
  const title = texts.find(t => t.qcRole === 'title'), sub = texts.find(t => t.qcRole === 'subtitle'), badgeBox = texts.find(t => t.qcRole === 'badge');
  if (!title || !sub || texts.some(t => t !== title && t !== sub && t !== badgeBox)) return;
  if (Math.abs(title.left - sub.left) > 6 || title.textAlign !== 'left' || sub.textAlign !== 'left' || sub.top < title.top) return;
  const gap = (): number => title.fontSize * title.scaleY * 0.3;
  const stack = (): { top: number; bottom: number } => {
    const size = title.fontSize * title.scaleY; const want = Math.min(size * 0.3, sub.fontSize * 2);
    if (want > sub.fontSize * sub.scaleY) sub.set({ fontSize: want, scaleX: 1, scaleY: 1 });
    // Headline, then subtitle one gap below it: closer than the template's anchor when far apart, and clear of it when overlapping.
    sub.set({ top: title.top + title.getScaledHeight() + gap() });
    const head = badgeBox ? badgeBox.top : title.top; if (badgeBox) badgeBox.set({ top: title.top - badgeBox.getScaledHeight() - gap() * 0.9 });
    return { top: badgeBox ? badgeBox.top : head, bottom: sub.top + sub.getScaledHeight() };
  };
  let block = stack();
  for (let guard = 0; block.bottom - block.top > height * 0.78 && guard < 12; guard++) { title.set({ fontSize: Math.max(36, title.fontSize * 0.92) }); block = stack(); }
  const shift = height * centre - (block.bottom + block.top) / 2;
  for (const o of [badgeBox, title, sub]) if (o) { o.set({ top: o.top + shift }); o.setCoords(); }
}

/**
 * Portrait covers with a subject on the lower half: stack badge, headline and subtitle together in the upper part so the
 * words and the picture never fight for the same pixels. The headline shrinks only if the block would not fit.
 */
export function arrangeForSubject(objects: FabricObject[], width: number, height: number): void {
  if (height < width * 1.1) return;
  const texts = objects.filter((o): o is Textbox & RoleBox => o instanceof Textbox);
  const title = texts.find(t => t.qcRole === 'title'), sub = texts.find(t => t.qcRole === 'subtitle'), badgeBox = texts.find(t => t.qcRole === 'badge');
  if (!title) return;
  // A huge faint glyph is a background ornament and an identical second copy of the title is its echo: neither blocks restacking.
  const echoes = texts.filter(t => t !== title && !t.qcRole && t.text === title.text);
  const ghost = (t: Textbox & RoleBox): boolean => t.qcRole === 'ghost' || (!t.qcRole && t.fontSize * (t.scaleY || 1) > height * 0.2);
  if (texts.some(t => t !== title && t !== sub && t !== badgeBox && !echoes.includes(t) && !ghost(t))) return;
  const offsets = echoes.map(e => ({ e, dx: e.left - title.left, dy: e.top - title.top }));
  const top0 = height * 0.07; const limit = height * 0.46; const gap = (): number => title.fontSize * title.scaleY * 0.28;
  const layout = (): number => {
    let y = top0; if (badgeBox) { badgeBox.set({ top: y }); y += badgeBox.getScaledHeight() + gap(); }
    title.set({ top: y }); y += title.getScaledHeight(); if (sub) { y += gap(); sub.set({ top: y }); y += sub.getScaledHeight(); } return y;
  };
  let bottom = layout();
  for (let guard = 0; bottom > limit && guard < 12; guard++) { title.set({ fontSize: Math.max(36, title.fontSize * 0.9) }); bottom = layout(); }
  for (const { e, dx, dy } of offsets) { e.set({ fontSize: title.fontSize, top: title.top + dy, left: title.left + dx }); e.initDimensions(); e.setCoords(); }
  for (const o of [badgeBox, title, sub]) o?.setCoords();
}

/** A decoration hung under the headline takes room: nudge the subtitle below it so the two never overlap. */
export function reserveBelowTitle(objects: FabricObject[], decorBottom: number): void {
  const texts = objects.filter((o): o is Textbox & RoleBox => o instanceof Textbox);
  const title = texts.find(t => t.qcRole === 'title'), sub = texts.find(t => t.qcRole === 'subtitle'); if (!title || !sub) return;
  const need = decorBottom + title.fontSize * title.scaleY * 0.14;
  if (sub.top >= title.top && sub.top < need) { sub.set({ top: need }); sub.setCoords(); }
}

/** Building blocks shared with the layout sets kept in their own files (gaoding.ts). */
export { rect, metrics, solid, pill, badge, sub, keep, meta, dot, lineW, FABRIC_LINE };
