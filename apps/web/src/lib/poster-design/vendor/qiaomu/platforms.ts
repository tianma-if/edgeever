/** Platform presets: sizes, feed overlays that cover parts of a cover, and file-size limits. */
export interface Zone { x: number; y: number; w: number; h: number; zh: string; en: string }
export interface Platform {
  id: string; zh: string; en: string; icon: string; group: 'social' | 'video' | 'general';
  width: number; height: number; zhHint: string; enHint: string;
  /** Inner text-safe margin as a fraction of the shorter side. */
  margin: number;
  /** Areas the platform usually draws over the cover (timestamps, counters, buttons). */
  avoid: Zone[];
  /** Upload limit in bytes when the platform has a documented one. */
  maxBytes?: number;
}

export const PLATFORMS: Platform[] = [
  { id: 'xhs', zh: '小红书 · 3:4', en: 'Xiaohongshu · 3:4', icon: 'book-heart', group: 'social', width: 1080, height: 1440, margin: 0.06, avoid: [],
    zhHint: '图文笔记封面，3:4 竖版最常用', enHint: 'Note cover, 3:4 portrait is the standard' },
  { id: 'xhs-square', zh: '小红书 · 1:1', en: 'Xiaohongshu · 1:1', icon: 'square', group: 'social', width: 1080, height: 1080, margin: 0.07, avoid: [],
    zhHint: '方形封面，信息流中更紧凑', enHint: 'Square cover, more compact in the feed' },
  { id: 'youtube', zh: 'YouTube 缩略图', en: 'YouTube thumbnail', icon: 'play', group: 'video', width: 1280, height: 720, margin: 0.04, maxBytes: 2 * 1024 * 1024,
    avoid: [{ x: 0.82, y: 0.86, w: 0.18, h: 0.14, zh: '时长标签', en: 'Duration' }],
    zhHint: '1280×720，文件不超过 2MB，右下角会被时长遮挡', enHint: '1280×720, under 2MB; the duration badge covers the bottom-right corner' },
  { id: 'bilibili', zh: 'B 站封面 · 16:10', en: 'Bilibili cover · 16:10', icon: 'tv', group: 'video', width: 1146, height: 717, margin: 0.04,
    avoid: [{ x: 0, y: 0.84, w: 1, h: 0.16, zh: '播放数据条', en: 'Stats bar' }],
    zhHint: '1146×717，信息流底部会叠加播放与弹幕数据', enHint: '1146×717; the feed overlays play counts along the bottom' },
  { id: 'bilibili-43', zh: 'B 站投稿 · 4:3', en: 'Bilibili upload · 4:3', icon: 'tv', group: 'video', width: 1200, height: 900, margin: 0.05,
    avoid: [{ x: 0, y: 0, w: 1, h: 0.08, zh: '信息流裁切', en: 'Cropped in feed' }, { x: 0, y: 0.78, w: 1, h: 0.22, zh: '裁切 + 播放数据条', en: 'Crop + stats bar' }],
    zhHint: '1200×900 投稿封面；信息流里按 16:10 裁切，文字放在中间 80% 内', enHint: '1200×900 upload cover; the feed crops it to 16:10, keep type in the middle band' },
  { id: 'bilibili-hd', zh: 'B 站 · 16:9 高清', en: 'Bilibili · 16:9 HD', icon: 'tv', group: 'video', width: 1920, height: 1080, margin: 0.04,
    avoid: [{ x: 0, y: 0.86, w: 1, h: 0.14, zh: '播放数据条', en: 'Stats bar' }],
    zhHint: '1920×1080，横版高清封面', enHint: '1920×1080 widescreen cover' },
  { id: 'vertical', zh: '抖音 / 视频号 · 9:16', en: 'Douyin / Shorts · 9:16', icon: 'smartphone', group: 'video', width: 1080, height: 1920, margin: 0.06,
    avoid: [{ x: 0, y: 0.78, w: 0.8, h: 0.22, zh: '标题与账号', en: 'Caption' }, { x: 0.84, y: 0.5, w: 0.16, h: 0.4, zh: '互动按钮', en: 'Buttons' }],
    zhHint: '竖屏短视频封面，底部和右侧会被界面遮挡', enHint: 'Vertical video; captions and buttons cover the bottom and right' },
  { id: 'wechat', zh: '公众号头图 · 2.35:1', en: 'WeChat banner · 2.35:1', icon: 'message-circle', group: 'social', width: 1410, height: 600, margin: 0.05, avoid: [],
    zhHint: '文章头图，列表中会被裁为 1:1 小图，主体放中间', enHint: 'Article banner; the feed crops a square from the centre' },
  { id: 'x', zh: 'X 封面 · 5:2', en: 'X header · 5:2', icon: 'at-sign', group: 'social', width: 1500, height: 600, margin: 0.05, avoid: [{ x: 0, y: 0.55, w: 0.3, h: 0.45, zh: '头像', en: 'Avatar' }],
    zhHint: '个人主页横幅，头像会遮住左下角', enHint: 'Profile header; the avatar covers the lower-left' },
  { id: 'square', zh: '方形 · 1:1', en: 'Square · 1:1', icon: 'square', group: 'general', width: 1080, height: 1080, margin: 0.06, avoid: [], zhHint: '通用方形', enHint: 'General square' },
  { id: 'wide', zh: '横版 · 16:9', en: 'Landscape · 16:9', icon: 'rectangle-horizontal', group: 'general', width: 1920, height: 1080, margin: 0.05, avoid: [], zhHint: '通用横版', enHint: 'General landscape' },
  { id: 'portrait', zh: '竖版 · 3:4', en: 'Portrait · 3:4', icon: 'rectangle-vertical', group: 'general', width: 1200, height: 1600, margin: 0.06, avoid: [], zhHint: '通用竖版', enHint: 'General portrait' },
];

export const DEFAULT_PLATFORM = 'xhs';
export function platformById(id: string | undefined): Platform | undefined { return PLATFORMS.find(p => p.id === id); }
export function platformFor(width: number, height: number, id?: string): Platform | undefined {
  const exact = platformById(id);
  if (exact && exact.width === width && exact.height === height) return exact;
  return PLATFORMS.find(p => p.width === width && p.height === height);
}
export function platformName(p: Platform, zh: boolean): string { return zh ? p.zh : p.en; }
export const GROUPS: { id: Platform['group']; zh: string; en: string }[] = [
  { id: 'social', zh: '图文平台', en: 'Social' },
  { id: 'video', zh: '视频平台', en: 'Video' },
  { id: 'general', zh: '通用比例', en: 'General' },
];
