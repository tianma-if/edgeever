export type Background = { kind: 'solid'; color: string } | { kind: 'linear'; from: string; to: string; angle: number };
export type ExportFormat = 'png' | 'jpeg' | 'webp';
export type Destination = 'folder' | 'note' | 'system';
export interface ExportPrefs {
  format: ExportFormat; scale: number; quality: number; destination: Destination;
  folder: string; systemDir: string; filename: string; insert: boolean; cover: boolean; copy: boolean; fitLimit: boolean;
}
export const EXPORT_DEFAULTS: ExportPrefs = {
  format: 'jpeg', scale: 1, quality: 0.92, destination: 'folder', folder: '', systemDir: '', filename: '{name}-{platform}', insert: false, cover: false, copy: false, fitLimit: true,
};
export interface Design {
  format: 'qiaomu-cover-design'; schema: 1; width: number; height: number; source?: string;
  /** Platform preset id. Informational: width/height remain the source of truth. */
  platform?: string; bg?: Background; export?: Partial<ExportPrefs>;
  /** Id of the template this cover was laid out from. Lets a platform switch re-lay it out instead of just scaling it. */
  template?: string;
  /** The palette the cover's layers follow (bg, bg2, ink, sub, accent, accentInk), so a later colour change knows what to replace. */
  palette?: { bg: string; bg2: string; ink: string; sub: string; accent: string; accentInk: string };
  canvas: Record<string, unknown>;
}
export const MAX_SIDE = 4096;
export const MIN_SIDE = 200;
export function validSize(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width >= MIN_SIDE && height >= MIN_SIDE && width <= MAX_SIDE && height <= MAX_SIDE;
}
const COLOR = /^#[\da-f]{6}$/i;
export function validBackground(value: unknown): value is Background {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  if (b.kind === 'solid') return typeof b.color === 'string' && COLOR.test(b.color);
  return b.kind === 'linear' && typeof b.from === 'string' && COLOR.test(b.from) && typeof b.to === 'string' && COLOR.test(b.to) && typeof b.angle === 'number' && Number.isFinite(b.angle);
}
/** File name from a template such as `{name}-{platform}-{date}`; never yields path separators. */
export function renderFilename(template: string, vars: Record<string, string>): string {
  const out = (template || '{name}').replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
  return safeName(out.replace(/\s+/g, ' ').trim()).replace(/ +/g, '-');
}
export function folderPath(value: string): string {
  const path = value.trim().replace(/\\/g,'/').replace(/\/+$/,'');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(p => !p || p === '..' || p === '.') || /[\x00-\x1f]/.test(path)) throw new Error('invalid-folder');
  return path;
}
export function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').trim().replace(/^\.+|\.+$/g,'').trim().slice(0,100) || 'Cover';
}
function checkCanvas(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error('invalid-design');
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('invalid-design');
    // Persisted image objects must be self-contained raster images. Never request remote URLs.
    if (key === 'src' && (typeof item !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(item))) throw new Error('invalid-design');
    checkCanvas(item, depth + 1);
  }
}
export function parseDesign(raw: string): Design {
  if (raw.length > 40_000_000) throw new Error('invalid-design');
  const d = JSON.parse(raw) as Design;
  if (!d || d.format !== 'qiaomu-cover-design' || d.schema !== 1 || !validSize(d.width,d.height) || !d.canvas || !Array.isArray(d.canvas.objects) || d.canvas.objects.length > 500 || (d.source !== undefined && typeof d.source !== 'string') || (d.platform !== undefined && typeof d.platform !== 'string') || (d.template !== undefined && typeof d.template !== 'string') || (d.bg !== undefined && !validBackground(d.bg)) || (d.export !== undefined && (typeof d.export !== 'object' || d.export === null))) throw new Error('invalid-design');
  checkCanvas(d.canvas);
  if (d.palette !== undefined && (typeof d.palette !== 'object' || d.palette === null || !['bg', 'bg2', 'ink', 'sub', 'accent', 'accentInk'].every(k => /^#[\da-f]{6}$/i.test(String((d.palette as Record<string, unknown>)[k]))))) delete d.palette;
  return d;
}
/**
 * Undo snapshots would otherwise hold one full copy of every embedded image per step.
 * Images are replaced by a shared reference so 40 steps cost one copy.
 */
export class SnapshotCodec {
  private images: string[] = []; private index = new Map<string, number>();
  encode(design: Design): string {
    return JSON.stringify(design, (key, value: unknown) => {
      if (key !== 'src' || typeof value !== 'string' || !value.startsWith('data:image/')) return value;
      let id = this.index.get(value);
      if (id === undefined) { id = this.images.length; this.images.push(value); this.index.set(value, id); }
      return `@img:${id}`;
    });
  }
  decode(snapshot: string): Design {
    return JSON.parse(snapshot, (key, value: unknown) => {
      if (key === 'src' && typeof value === 'string' && value.startsWith('@img:')) {
        const image = this.images[Number(value.slice(5))];
        if (image === undefined) throw new Error('invalid-design');
        return image;
      }
      return value;
    }) as Design;
  }
}
export class History {
  private entries: string[] = []; private index = -1;
  reset(value: string): void { this.entries = [value]; this.index = 0; }
  /** Font metrics can normalize a restored snapshot without creating a new edit or losing redo. */
  replaceCurrent(value: string): void { if (this.index >= 0) this.entries[this.index] = value; }
  push(value: string): void {
    if (value === this.entries[this.index]) return;
    this.entries = this.entries.slice(0,this.index + 1); this.entries.push(value);
    if (this.entries.length > 40) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  canStep(direction: -1|1): boolean { const i = this.index + direction; return i >= 0 && i < this.entries.length; }
  step(direction: -1|1): string|undefined {
    const index = this.index + direction;
    if (index < 0 || index >= this.entries.length) return;
    this.index = index; return this.entries[index];
  }
}
export class SerialWriter {
  private tail: Promise<void> = Promise.resolve();
  run(task: () => Promise<void>): Promise<void> {
    const result = this.tail.then(task); this.tail = result.catch(() => {}); return result;
  }
}
