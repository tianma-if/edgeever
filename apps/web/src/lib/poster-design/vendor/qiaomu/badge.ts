/**
 * A text label with a filled pill behind it, drawn by hand so the words sit exactly in the middle.
 * Fabric's own text background fills the whole line box, and the extra leading ends up on one side, so CJK labels look
 * dropped. Here the pill is sized from the measured glyph height of a reference character and the baseline is placed so
 * its cap height is centred, with equal padding left and right. Serialises as an ordinary object and reloads by type.
 */
import { classRegistry, getEnv, Textbox, TextboxProps } from 'fabric';

export interface BadgeProps { badgeBg: string; padX: number; padY: number; radius: number }
let ctx2d: CanvasRenderingContext2D | null | undefined;
function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx2d === undefined) { try { ctx2d = getEnv().document?.createElement('canvas').getContext('2d') ?? null; } catch { ctx2d = null; } }
  return ctx2d;
}
interface Metrics { width: number; ascent: number; descent: number }
/** Width of the text and the ink extent of a reference glyph pair (cap/CJK height), in px. */
export function measureLabel(text: string, size: number, weight: string, family: string): Metrics {
  const c = measureCtx(); if (!c) return { width: [...text].length * size * 0.8, ascent: size * 0.8, descent: size * 0.04 };
  c.font = `${weight} ${size}px ${family}`; const width = c.measureText(text).width; const ref = c.measureText('H国');
  return { width, ascent: ref.actualBoundingBoxAscent || size * 0.8, descent: Math.max(0, ref.actualBoundingBoxDescent || size * 0.04) };
}

export class BadgeBox extends Textbox {
  static type = 'BadgeBox';
  static customProperties = ['badgeBg', 'padX', 'padY', 'radius'];
  declare badgeBg: string; declare padX: number; declare padY: number; declare radius: number;
  constructor(text: string, options?: Partial<TextboxProps> & Partial<BadgeProps>) { super(text, { badgeBg: '#111111', padX: 0.6, padY: 0.34, radius: 0.5, editable: false, lineHeight: 1, ...options } as Partial<TextboxProps>); }
  private metrics(): Metrics { return measureLabel(this.text.trim(), this.fontSize, String(this.fontWeight), this.fontFamily); }
  /** Size comes from the measured label, not from Fabric's line layout. */
  initDimensions(): void {
    const m = this.metrics(); const px = this.padX * this.fontSize, py = this.padY * this.fontSize;
    this.width = m.width + px * 2; this.height = m.ascent + m.descent + py * 2;
    this.textLines = [this.text]; this._textLines = [[...this.text]]; this.dirty = true;
  }
  /** The pill is the visible extent. Fabric's own line cache is never filled here, so its version would throw. */
  getLineWidth(): number { return this.width; }
  _render(c: CanvasRenderingContext2D): void {
    const w = this.width, h = this.height; const m = this.metrics(); const r = Math.min(h / 2, this.radius * h);
    c.save(); c.fillStyle = this.badgeBg; c.beginPath();
    c.moveTo(-w / 2 + r, -h / 2); c.arcTo(w / 2, -h / 2, w / 2, h / 2, r); c.arcTo(w / 2, h / 2, -w / 2, h / 2, r); c.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); c.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r); c.closePath(); c.fill();
    c.fillStyle = typeof this.fill === 'string' ? this.fill : '#ffffff'; c.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText(this.text.trim(), 0, (m.ascent - m.descent) / 2); c.restore();
  }
}
classRegistry.setClass(BadgeBox, 'BadgeBox');
