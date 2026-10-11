/**
 * Font pairing rules. A cover uses at most two families: one display face for the title (and badge) and one calm face for everything
 * else. Each template names a mood; the mood lists candidates best first, and the first installed one wins, so a cover always looks
 * right with what the user has and better with what the starter pack installs.
 *
 * Rules the lists encode:
 *  1. Title = display face, body = neutral face. Never two display faces.
 *  2. Weight contrast does the hierarchy: a single-weight heavy title over a regular body, never bold-on-bold.
 *  3. Heavy display faces are single-weight, so they are never faux-bolded.
 *  4. Serif titles pair with a warm kai/song body; sans titles with a plain gothic body.
 */
export type Mood = 'heavy' | 'punch' | 'tech' | 'trend' | 'warm' | 'serif' | 'brush';
export interface Pair { title: string[]; body: string[]; zh: string }

// The default font library comes first everywhere, so a fresh install looks exactly like the design; system faces only catch
// the moment before the library has landed.
const BODY = ['思源黑体', 'PingFang SC', 'Microsoft YaHei'];
export const MOODS: Record<Mood, Pair> = {
  heavy: { zh: '稳重有力', title: ['思源黑体 Heavy', '思源黑体 Bold', 'PingFang SC'], body: BODY },
  punch: { zh: '冲击抓眼', title: ['抖音美好体', '思源黑体 Heavy', '思源黑体 Bold', 'PingFang SC'], body: BODY },
  tech: { zh: '科技数据', title: ['未来荧黑', '得意黑', '思源黑体 Heavy'], body: BODY },
  trend: { zh: '潮流年轻', title: ['得意黑', '抖音美好体', '站酷庆科黄油体'], body: BODY },
  warm: { zh: '亲切活泼', title: ['江城圆体', '站酷庆科黄油体', '猫啃什锦黑', '抖音美好体'], body: BODY },
  serif: { zh: '文艺深度', title: ['思源宋体 Heavy', '朱雀仿宋', '思源宋体 Bold', 'Songti SC'], body: ['霞鹜文楷', '思源宋体', ...BODY] },
  brush: { zh: '国风书法', title: ['马善政楷书', '志莽行书', '朱雀仿宋'], body: ['朱雀仿宋', '霞鹜文楷', '思源宋体', ...BODY] },
};

const TEMPLATE_FACES: Record<string, string[]> = {
  keyword: ['得意黑'], riso: ['站酷快乐体', '站酷庆科黄油体'],
  newspaper: ['思源宋体 Heavy'], mag: ['朱雀仿宋', '思源宋体 Heavy'],
  notes: ['霞鹜文楷'], numeral: ['未来荧黑'],
  window: ['未来荧黑', '得意黑'], brush: ['抖音美好体', '思源黑体 Heavy', '思源黑体 Bold'],
  polaroid: ['霞鹜文楷', '站酷庆科黄油体'], stack: ['抖音美好体', '思源黑体 Heavy', '思源黑体 Bold'],
};

const MOOD_OF: Record<string, Mood> = {
  minimal: 'heavy', editorial: 'serif', bold: 'punch', dark: 'tech', poster: 'heavy', split: 'heavy', sticker: 'warm', gradient: 'trend', center: 'punch',
  checklist: 'warm', number: 'tech', impact: 'punch', photo: 'heavy', bili: 'punch', compare: 'punch', neo: 'punch', soft: 'serif', swiss: 'heavy',
  acid: 'trend', collage: 'warm', mega: 'heavy', ticker: 'tech', memo: 'warm', pop: 'trend', mag: 'serif', print: 'heavy', glass: 'heavy', bento: 'heavy',
  neon: 'tech', calm: 'serif', seal: 'brush', quote: 'serif', cinema: 'serif',
  highlight: 'punch', notes: 'heavy', chat: 'heavy', keyword: 'punch', riso: 'trend', ticket: 'heavy', window: 'tech', newspaper: 'serif', polaroid: 'warm',
  stack: 'heavy', serial: 'heavy', aurora: 'tech', folio: 'heavy', sage: 'heavy', numeral: 'tech',
  regeng: 'heavy', interview: 'punch', brush: 'punch', calendar: 'heavy', frame: 'heavy', kicker: 'heavy', corner: 'heavy',
};
export const moodOf = (templateId: string | undefined): Mood => MOOD_OF[templateId ?? ''] ?? 'heavy';

/** Faces that ship a real bold. Everything else in the lists is single-weight and must not be faux-bolded. */
// Library faces are one weight per family (思源黑体 / Bold / Heavy are separate families), so only system faces get a real bold.
const HAS_BOLD = new Set(['PingFang SC', 'Songti SC', 'Microsoft YaHei', 'MiSans', '鸿蒙黑体', '阿里巴巴普惠体']);

export interface Resolved { title?: string; body?: string; titleBold: boolean; /** Best title/body families that are not installed yet. */ missing: string[] }
/** Picks the first installed family of each list. `missing` names the top choice per role when it is not installed. */
export function resolvePair(templateId: string | undefined, have: (family: string) => boolean): Resolved {
  const mood = MOODS[moodOf(templateId)];
  const title = [...(TEMPLATE_FACES[templateId ?? ''] ?? []), ...mood.title, ...BODY].find(have), body = mood.body.find(have);
  const missing = [mood.title[0], mood.body[0]].filter((f): f is string => !!f && !have(f));
  return { ...(title ? { title } : {}), ...(body ? { body } : {}), titleBold: !!title && HAS_BOLD.has(title), missing: [...new Set(missing)] };
}

/** The pairing the template builders read while they build. Set by the view just before `build`, cleared right after. */
let active: Resolved | undefined;
export function usePairing(r: Resolved | undefined): void { active = r; }
const GENERIC = new Set(['sans-serif', 'serif']);
/** Swaps the generic family a builder asked for with the paired one. Monospace and explicit families are left alone. */
export function typeFor(role: string | undefined, family: string | undefined, weight: string | undefined): { fontFamily?: string; fontWeight?: string } {
  if (!active || !family || !GENERIC.has(family)) return {};
  const display = role === 'title' || role === 'badge';
  const face = display ? active.title : active.body;
  if (!face) return {};
  return { fontFamily: face, ...(display && !active.titleBold && (weight === 'bold' || weight === '700') ? { fontWeight: 'normal' } : {}) };
}
/** Family the title is measured with, so wrapping decisions match what is drawn. */
export const titleFace = (): string => (active?.title ? `"${active.title}"` : 'sans-serif');
