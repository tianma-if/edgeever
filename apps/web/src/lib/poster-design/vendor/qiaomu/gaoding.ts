/**
 * Layouts drawn from the formats that dominate the Gaoding (稿定设计) recommended feed for Xiaohongshu and WeChat, kept to the
 * ones that live on type and flat shapes alone (no stock photo, no illustration), redrawn to the design rules: one focal
 * headline, flat colour, no outlined type, no starbursts. Helpers come from templates.ts and are only used inside build().
 */
import { Circle, FabricObject, Line, Path, Polygon, Rect, Shadow } from 'fabric';
import { grain } from './kit';
import { badge, dot, FABRIC_LINE, fitTitle, hasCjk, keep, lineW, metrics, meta, pill, rect, solid, sub, Template, textbox, textHeight, wrapLines, palette } from './templates';

const XHS = ['xhs', 'xhs-square', 'portrait', 'square']; const VIDEO = ['youtube', 'bilibili', 'bilibili-43', 'bilibili-hd', 'wide']; const BANNER = ['wechat', 'x'];
/** Items for a checklist row: the points, or a subtitle written as a list. */
const items = (points: string[] | undefined, subtitle: string, max: number): string[] => {
  const xs = (points?.length ? points : subtitle.split(/[\n,，、；;|｜]/)).map(s => s.trim()).filter(Boolean);
  return xs.length >= 2 ? xs.slice(0, max) : [];
};
/** Tags a shape as part of the layout's signature, so the clean-up that runs when a subject picture arrives keeps it. */
const mark = <T extends FabricObject>(o: T, kind: 'mark' | 'mark-title' = 'mark'): T => Object.assign(o, { qcKind: kind });
/** A hand-drawn arrow: one curved stroke and an open head, round caps. From (x0,y0) bending to (x1,y1). */
function arrow(x0: number, y0: number, x1: number, y1: number, bend: number, color: string, weight: number): Path {
  const mx = (x0 + x1) / 2 + bend, my = (y0 + y1) / 2 - bend * 0.4;
  const ang = Math.atan2(y1 - my, x1 - mx); const head = weight * 3.4;
  const a = (k: number): string => `${(x1 - Math.cos(ang + k) * head).toFixed(1)} ${(y1 - Math.sin(ang + k) * head).toFixed(1)}`;
  return mark(new Path(`M${x0} ${y0} Q${mx} ${my} ${x1} ${y1} M${a(0.55)} L${x1} ${y1} L${a(-0.55)}`, { fill: '', stroke: color, strokeWidth: weight, strokeLineCap: 'round', strokeLineJoin: 'round', objectCaching: false }));
}
/** A dry-brush block: a rectangle with ragged, slightly wavy long edges, for a highlighter stroke made by a brush. */
function brushBlock(x: number, y: number, w: number, h: number, color: string, seed = 3): Path {
  const n = 9; let s = seed * 7919 + 17; const rnd = (): number => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  let d = `M${x} ${y + h * 0.12}`;
  for (let k = 1; k <= n; k++) d += ` L${(x + (w * k) / n).toFixed(1)} ${(y + h * (0.04 + rnd() * 0.16)).toFixed(1)}`;
  d += ` L${(x + w + h * 0.12).toFixed(1)} ${(y + h * 0.55).toFixed(1)}`;
  for (let k = n; k >= 0; k--) d += ` L${(x + (w * k) / n).toFixed(1)} ${(y + h * (0.84 + rnd() * 0.14)).toFixed(1)}`;
  return mark(new Path(`${d} Z`, { fill: color, stroke: '', angle: -1.2 }), 'mark-title');
}

export const GAODING: Template[] = [
  {
    id: 'regeng', zh: '热梗卡', en: 'Daily drop', fit: [...XHS, 'wechat'], zhUse: '黑色话题条（#标签#）+ 三层错位描边卡片里的粗黑大字 + 左下“No.期号”；每日热梗、资讯速递、系列笔记，小红书辨识度很高', enUse: 'A black hashtag bar, a heavy headline in a stack of three offset outlined cards and an issue number; daily drops, news and series notes',
    build(i) {
      const p = palette(i, { bg: '#f2f2ef', bg2: '#f2f2ef', ink: '#111111', sub: '#4b4b4b', accent: '#e8432b', accentInk: '#ffffff' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.25; const bar = Math.max(56, 88 * u); const sw = Math.max(4, 6 * u); const off = Math.max(8, 14 * u);
      const tag = (i.badge?.trim() || (i.zh ? '每日新鲜事' : 'daily')).replace(/^#|#$/g, '');
      const bx = m, by = bar + m * 0.9; const bw = side ? w * 0.6 - m : w - m * 2 - off * 2; const bh = side ? h - by - m - off * 2 : h * 0.5;
      const pad = Math.max(m * 0.6, 34 * u); const tw = bw - pad * 2;
      const size = fitTitle(i.title, tw, bh - pad * 2, 200 * u, 36, 1.08); const th = textHeight(i.title, tw, size, 1.08);
      const card = (k: number): Rect => rect(bx + off * k, by + off * k, bw, bh, k ? p.bg : '#ffffff', { stroke: p.ink, strokeWidth: sw });
      const no = `No.${String(Number(/\d+/.exec(i.badge ?? '')?.[0] ?? 1)).padStart(3, '0')}`; const ns = Math.max(40, Math.min(110 * u, h * 0.07));
      const nx = side ? bx + bw + off * 2 + m : bx; const ny = side ? by : by + bh + off * 2 + m * 0.8; const nw = side ? w - nx - m : w - m * 2;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.05, 151),
        rect(0, 0, w, bar, p.ink),
        textbox(`#${tag}#`, m, (bar - bar * 0.42 * 1.13) / 2, w * 0.6, { qcRole: 'badge', fontSize: bar * 0.42, fill: '#ffffff', fontWeight: 'bold', lineHeight: 1 }),
        // The record switch lives in the bar: a white track with the red "live" light on.
        rect(w - m - bar * 0.95, bar * 0.3, bar * 0.95, bar * 0.4, 'rgba(0,0,0,0)', { rx: bar * 0.2, ry: bar * 0.2, stroke: '#ffffff', strokeWidth: Math.max(2, 3 * u) }),
        dot(w - m - bar * 0.25, bar * 0.5, bar * 0.13, p.accent),
        card(2), card(1), card(0),
        textbox(i.title, bx + pad, by + (bh - th) / 2, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08 }),
        textbox(no, nx, ny, nw, { fontSize: ns, fill: p.ink, fontFamily: 'Anton', lineHeight: 1, charSpacing: 20 }),
        rect(nx, ny + ns * 1.22, Math.max(40, ns * 0.9), Math.max(4, 6 * u), p.accent),
        ...sub(i, nx, ny + ns * 1.22 + 24 * u, nw, Math.max(24, size * 0.3), p.sub, { fontWeight: 'bold' }),
      ) };
    },
  },
  {
    id: 'interview', zh: '黑黄箭头', en: 'Black & yellow', fit: [...XHS, ...VIDEO, 'vertical'], zhUse: '黑底 + 黄色超粗标题 + 一条手绘大箭头指向标题 + 白框英文标签 + 角落笑脸；面试、考试、干货清单，强对比又不土', enUse: 'Black, a heavy yellow headline, one big hand-drawn arrow pointing at it, a boxed label and a corner smiley; interviews, exams and checklists',
    build(i) {
      const p = palette(i, { bg: '#0f0f0f', bg2: '#0f0f0f', ink: '#ffe14a', sub: '#ffffff', accent: '#ffe14a', accentInk: '#0f0f0f' });
      const { u, m, w, h } = metrics(i); const side = w / h > 1.25; const x0 = m * 1.1; const tw = side ? w * 0.62 - x0 : w - x0 * 2;
      const label = (i.badge?.trim() || 'INTERVIEW').toUpperCase(); const ls = Math.max(30, Math.min(side ? h * 0.1 : w * 0.085, (tw * 0.9) / Math.max(4, [...label].length * (hasCjk(label) ? 1 : 0.62))));
      const lh = ls * 1.5; const ly = m * 0.9; const lw = Math.min(tw, lineW(label, ls, 'bold', 0) + ls * 1.2);
      const size = fitTitle(i.title, tw, h * (side ? 0.5 : 0.36), 230 * u, 40, 1.04); const th = textHeight(i.title, tw, size, 1.04);
      const subS = Math.max(24, size * 0.28); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subS, 1.25) + 28 * u : 0;
      const ty = side ? Math.max(ly + lh + m * 0.6, (h - th - subH) / 2) : Math.max(ly + lh + h * 0.16, h * 0.42 - th / 2);
      const aw = Math.max(10, 24 * u);
      const arrowTo = { x: side ? x0 + tw + m * 0.2 : x0 + tw * 0.62, y: ty - (side ? -th * 0.2 : m * 0.25) };
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.07, 157),
        rect(x0, ly, lw, lh, 'rgba(0,0,0,0)', { stroke: '#ffffff', strokeWidth: Math.max(3, 5 * u) }),
        textbox(label, x0, ly + (lh - ls * 1.13) / 2, lw, { qcRole: 'badge', fontSize: ls, fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', lineHeight: 1 }),
        arrow(side ? w - m * 1.2 : w - m * 1.1, side ? h * 0.18 : ly + lh * 0.6, arrowTo.x, arrowTo.y, side ? -w * 0.06 : -w * 0.12, p.accent, aw),
        textbox(i.title, x0, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.04 }),
        ...sub(i, x0, ty + th + 28 * u, tw, subS, p.sub, { fontWeight: 'bold' }),
        textbox(':)', w - m - 120 * u, h - m - 70 * u, 120 * u, { fontSize: Math.max(40, 64 * u), fill: '#ffffff', fontWeight: 'bold', textAlign: 'right', lineHeight: 1 }),
      ) };
    },
  },
  {
    id: 'brush', zh: '笔刷收藏', en: 'Brush highlight', fit: [...XHS, 'wechat', ...VIDEO], zhUse: '白底粗黑标题 + 最后一行压一道绿色笔刷 + 歪贴的“建议收藏!”标签 + 底部 ✓ 清单（points）；副业、避坑、干货，最像小红书爆款笔记', enUse: 'Heavy black type on white, a green brush stroke under the last line, a tilted “save this” tag and a check row from the points; tips and side hustles',
    build(i) {
      const p = palette(i, { bg: '#ffffff', bg2: '#ffffff', ink: '#111111', sub: '#4b4b4b', accent: '#3ddc84', accentInk: '#111111' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.1; const tw = (w - x0 * 2) * (wide ? 0.82 : 1); const lh = 1.12;
      const size = fitTitle(i.title, tw, h * (wide ? 0.5 : 0.48), 240 * u, 40, lh); const lines = wrapLines(i.title, tw, size, 'bold', -18); const step = size * lh * FABRIC_LINE; const th = lines.length * step;
      const checks = items(i.points, i.subtitle, 3); const cs = Math.max(24, size * 0.28);
      // The check row wraps instead of running off the page; its height is known before the block is centred.
      const cw = (t: string): number => cs * 2.2 + lineW(t, cs, 'bold', 0); const flow: { t: string; x: number; y: number }[] = []; { let fx = 0, fy = 0; for (const t of checks) { if (fx && fx + cw(t) > tw) { fx = 0; fy += cs * 1.7; } flow.push({ t, x: fx, y: fy }); fx += cw(t); } }
      const rowH = checks.length ? (flow[flow.length - 1]!.y + cs * 1.4) : 0;
      const subS = Math.max(24, size * 0.28); const subH = !checks.length && i.subtitle.trim() ? textHeight(i.subtitle, tw, subS, 1.25) + 30 * u : 0;
      const tagS = Math.max(22, size * 0.24); const tagH = tagS * 1.3 * 1.7 + 40 * u;
      const ty = (h - tagH - th - subH - rowH - (rowH ? 40 * u : 0)) / 2 + tagH; const last = lines[lines.length - 1] ?? '';
      const ray = (k: number): Line => { const a = (-150 - k * 28) * Math.PI / 180; const cx = x0 + tagS * 0.2, cy = ty - tagH * 0.55; const r0 = tagS * 0.9, r1 = tagS * 1.6; return mark(new Line([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1], { stroke: p.ink, strokeWidth: Math.max(3, 5 * u), strokeLineCap: 'round' }), 'mark-title'); };
      const rowY = ty + th + 40 * u;
      const row = flow.flatMap(({ t, x, y }) => { const cx = x0 + x, cy = rowY + y; return [dot(cx + cs * 0.5, cy + cs * 0.62, cs * 0.5, p.accent), textbox('✓', cx + cs * 0.1, cy + cs * 0.06, cs * 0.8, { fontSize: cs * 0.9, fill: p.ink, fontWeight: 'bold', textAlign: 'center', lineHeight: 1 }), textbox(t, cx + cs * 1.3, cy, lineW(t, cs, 'bold', 0) + cs, { fontSize: cs, fill: p.ink, fontWeight: 'bold', lineHeight: 1.1 })]; });
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.04, 163),
        brushBlock(x0 - size * 0.1, ty + (lines.length - 1) * step + size * 0.22, Math.min(w - x0, lineW(last, size) + size * 0.25), size * 0.95, p.accent, lines.length),
        ray(0), ray(1), ray(2),
        pill(i.badge?.trim() || (i.zh ? '建议收藏!' : 'Save this!'), x0 + tagS * 0.4, ty - tagH, p.accent, p.accentInk, tagS * 1.3, { qcRole: 'badge', angle: -8, radius: 0.3 }),
        textbox(i.title, x0, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: lh, charSpacing: -18 }),
        ...(checks.length ? row : sub(i, x0, ty + th + 30 * u, tw, subS, p.sub, { fontWeight: 'bold' })),
      ) };
    },
  },
  {
    id: 'calendar', zh: '日历页', en: 'Calendar page', fit: [...XHS, 'wechat', ...VIDEO], zhUse: '纯蓝底 + 一张带装订环的白色日历页 + 页里的粗黑大字；每日一句、打卡、待办、节日，干净有仪式感', enUse: 'Flat blue with a white calendar page and binding rings, a heavy headline on the page; daily lines, check-ins and to-dos',
    build(i) {
      const p = palette(i, { bg: '#2f6bff', bg2: '#2f6bff', ink: '#111111', sub: '#555555', accent: '#2f6bff', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const cw = wide ? w * 0.7 : w - m * 2.2; const ch = wide ? h - m * 2.4 : h * 0.66; const cx = (w - cw) / 2; const cy = (h - ch) / 2 + m * 0.3;
      const r = Math.max(10, 16 * u); const pad = Math.max(m * 0.8, 44 * u); const tw = cw - pad * 2; const holes = Math.max(6, Math.round(cw / (r * 5)));
      const size = fitTitle(i.title, tw, ch * 0.5, 220 * u, 36, 1.08); const th = textHeight(i.title, tw, size, 1.08);
      const subS = Math.max(24, size * 0.3); const subH = i.subtitle.trim() ? textHeight(i.subtitle, tw, subS, 1.25) + 30 * u : 0; const head = r * 4;
      const ty = cy + head + (ch - head - th - subH) / 2;
      const rings = Array.from({ length: holes }, (_, k) => { const x = cx + (cw / holes) * (k + 0.5); return [mark(dot(x, cy + r * 1.6, r * 0.55, p.bg)), mark(new Rect({ left: x - r * 0.28, top: cy - r * 1.1, width: r * 0.56, height: r * 2.8, rx: r * 0.28, ry: r * 0.28, fill: '#1b1b1b', originX: 'left', originY: 'top' }))]; }).flat();
      return { background: solid(p.bg), objects: keep<FabricObject>(
        grain(w, h, 0.06, 167),
        rect(cx + 14 * u, cy + 18 * u, cw, ch, '#dfe6ff', { rx: 18 * u, ry: 18 * u }),
        rect(cx, cy, cw, ch, '#ffffff', { rx: 18 * u, ry: 18 * u, shadow: new Shadow({ color: 'rgba(0,20,90,0.25)', blur: 40 * u, offsetX: 0, offsetY: 16 * u }) }),
        ...rings,
        meta((i.badge?.trim() || (i.zh ? '今日' : 'TODAY')).toUpperCase(), cx + pad, cy + head * 0.75, tw * 0.6, Math.max(16, 22 * u), p.accent, { qcRole: 'badge' }),
        textbox(i.title, cx + pad, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08, textAlign: 'center' }),
        ...sub(i, cx + pad, ty + th + 30 * u, tw, subS, p.sub, { textAlign: 'center' }),
      ) };
    },
  },
  {
    id: 'frame', zh: '框线大字', en: 'Framed type', fit: [...XHS, ...BANNER, ...VIDEO], zhUse: '纯色底 + 一圈细内框 + 撑满框的超大标题 + 一角出血的太阳圆；招聘、开学、通知、活动，最简单也最醒目', enUse: 'Flat colour, a thin inset frame, a headline that fills it and a sun disc bleeding off a corner; hiring, launches and notices',
    build(i) {
      const p = palette(i, { bg: '#22b573', bg2: '#22b573', ink: '#0f2a1d', sub: '#0f2a1d', accent: '#f4e04d', accentInk: '#0f2a1d' });
      const { u, m, w, h, wide } = metrics(i); const f = m * 0.55; const pad = m * 0.9; const tw = w - (f + pad) * 2;
      // The subtitle rides right under the headline: the foot of the frame is left to the sun and to platform UI (9:16 captions).
      const subS = Math.max(24, 32 * u); const sw = tw * 0.8; const subH = i.subtitle.trim() ? textHeight(i.subtitle, sw, subS, 1.25) + 30 * u : 0; const bs = Math.max(22, 34 * u); const bH = i.badge?.trim() ? bs * 1.3 * 1.8 + 16 * u : 0;
      // On a banner (wider than 2.2:1) the copy hangs from the top: the lower left is where X puts the avatar.
      const banner = w / h > 2.2; const room = h - (f + pad) * 2 - bH; const size = fitTitle(i.title, tw, (room - subH) * (banner ? 0.62 : wide ? 0.86 : 0.58), 420 * u, 44, 1.02); const th = textHeight(i.title, tw, size, 1.02);
      const ty = f + pad + bH + (banner ? 0 : wide ? (room - subH - th) / 2 : room * 0.04); const R = Math.min(w, h) * 0.34;
      return { background: solid(p.bg), objects: keep<FabricObject>(
        new Circle({ left: w - R * 1.45, top: h - R * 1.25, radius: R, fill: p.accent, opacity: 0.85, originX: 'left', originY: 'top' }),
        grain(w, h, 0.08, 173),
        // qcRole marks the border as the page's structure, so platform avoidance moves the words inside it and leaves it whole.
        rect(f, f, w - f * 2, h - f * 2, 'rgba(0,0,0,0)', { stroke: p.ink, strokeWidth: Math.max(2, 3 * u), qcRole: 'frame' }),
        ...badge(i.badge, f + pad, f + pad * 0.7, { ...p, accent: p.ink, accentInk: p.bg }, bs),
        textbox(i.title, f + pad, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.02 }),
        ...sub(i, f + pad, ty + th + 30 * u, sw, subS, p.sub, { fontWeight: 'bold' }),
      ) };
    },
  },
  {
    id: 'kicker', zh: '粗细引题', en: 'Kicker headline', fit: [...XHS, 'wechat', ...VIDEO], zhUse: '浅灰底：副标题当细字引题写在上面，标题粗黑放大 + 双线胶囊标签 + 底部“右滑查看 ››››”；经验、问答、职场，信息感强', enUse: 'Light grey: the subtitle as a thin kicker above a heavy headline, a double-ring pill tag and a “swipe” cue; experience posts, Q&A, work',
    build(i) {
      const p = palette(i, { bg: '#ececea', bg2: '#ececea', ink: '#111111', sub: '#2b2b2b', accent: '#111111', accentInk: '#ffffff' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.1; const tw = (w - x0 * 2) * (wide ? 0.72 : 1);
      const size = fitTitle(i.title, tw, h * (wide ? 0.42 : 0.32), 200 * u, 40, 1.08); const th = textHeight(i.title, tw, size, 1.08);
      const ks = Math.max(26, size * 0.46); const kick = i.subtitle.trim(); const kh = kick ? textHeight(kick, tw, ks, 1.2) + size * 0.18 : 0;
      const label = i.badge?.trim() ?? ''; const tagS = Math.max(20, size * 0.2); const gap = 8 * u;
      const rw = label ? lineW(label, tagS, 'bold', 0) + tagS * 1.6 : 0; const rh = tagS * 2; const tagH = label ? rh + gap * 2 + 36 * u : 0; const foot = Math.max(22, 30 * u);
      const top = (h - tagH - kh - th) / 2 + tagH; const R = Math.min(w, h) * 0.42; const ry = top - tagH;
      const ring = (k: number): Rect => rect(x0 + gap * (1 - k), ry + gap * (1 - k), rw + gap * 2 * k, rh + gap * 2 * k, 'rgba(0,0,0,0)', { rx: (rh + gap * 2 * k) / 2, ry: (rh + gap * 2 * k) / 2, stroke: p.ink, strokeWidth: Math.max(1.5, (k ? 2.5 : 2) * u) });
      const tag = label ? textbox(label, x0 + gap, ry + gap + (rh - tagS * 1.13) / 2, rw, { qcRole: 'badge', fontSize: tagS, fill: p.ink, fontWeight: 'bold', textAlign: 'center', lineHeight: 1 }) : undefined;
      const rings = label ? [ring(1), ring(0)] : [];
      return { background: solid(p.bg), objects: keep<FabricObject>(
        new Circle({ left: w - R * 1.25, top: h - R * 1.5, radius: R, fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0.06)', strokeWidth: R * 0.32, originX: 'left', originY: 'top' }),
        grain(w, h, 0.06, 179), ...rings, tag,
        ...(kick ? [textbox(kick, x0, top, tw, { qcRole: 'subtitle', fontSize: ks, fill: p.sub, lineHeight: 1.2 })] : []),
        textbox(i.title, x0, top + kh, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08 }),
        textbox(i.zh ? '右滑查看  ››››' : 'Swipe  ››››', x0, h - m - foot * 1.4, w * 0.5, { fontSize: foot, fill: p.ink, fontWeight: 'bold', lineHeight: 1 }),
      ) };
    },
  },
  {
    id: 'corner', zh: '斜角色块', en: 'Corner wedge', fit: [...XHS, ...VIDEO, 'wechat'], zhUse: '白底 + 右下一大块斜切薄荷色 + 左上粗黑大字 + 黑色胶囊副标题 + 一条弯箭头；计划、清单、自律、学习，清爽有节奏', enUse: 'White with a big mint wedge from the lower right, a heavy headline top left, a black pill subtitle and a curved arrow; plans, lists and study',
    build(i) {
      const p = palette(i, { bg: '#ffffff', bg2: '#ffffff', ink: '#111111', sub: '#ffffff', accent: '#7ee0c3', accentInk: '#111111' });
      const { u, m, w, h, wide } = metrics(i); const x0 = m * 1.1; const tw = (w - x0 * 2) * (wide ? 0.6 : 0.86);
      const size = fitTitle(i.title, tw, h * (wide ? 0.5 : 0.34), 220 * u, 40, 1.08); const th = textHeight(i.title, tw, size, 1.08); const ty = m * 1.2 + (i.badge?.trim() ? Math.max(16, 20 * u) * 2.2 : 0);
      const subS = Math.max(22, size * 0.24);
      return { background: solid(p.bg), objects: keep<FabricObject>(
        new Polygon([{ x: w, y: h * (wide ? 0.05 : 0.3) }, { x: w, y: h }, { x: w * (wide ? 0.45 : 0.08), y: h }], { fill: p.accent, originX: 'left', originY: 'top' }),
        grain(w, h, 0.05, 181),
        i.badge?.trim() ? meta(i.badge.trim().toUpperCase(), x0, m * 1.1, w * 0.6, Math.max(16, 20 * u), p.ink, { qcRole: 'badge' }) : undefined,
        textbox(i.title, x0, ty, tw, { qcRole: 'title', fontSize: size, fill: p.ink, fontWeight: 'bold', lineHeight: 1.08 }),
        ...(i.subtitle.trim() ? [pill(i.subtitle, x0, ty + th + 30 * u, p.ink, p.sub, subS, { qcRole: 'subtitle', radius: 0.5 })] : []),
        arrow(w * (wide ? 0.72 : 0.62), h - m * 1.6, w - m * 1.2, h - m * (wide ? 3.2 : 4.2), -w * 0.04, p.ink, Math.max(6, 12 * u)),
      ) };
    },
  },
];
