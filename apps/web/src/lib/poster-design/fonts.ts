export const POSTER_FONTS = [
  {
    family: "思源宋体",
    file: "notoserif",
    zh: "思源宋体 · 正文",
    en: "Source Han Serif",
  },
  { family: "Anton", file: "anton", zh: "Anton · 冲击", en: "Anton" },
  {
    family: "抖音美好体",
    file: "douyin",
    zh: "抖音美好体",
    en: "Douyin Display",
  },
  {
    family: "马善政楷书",
    file: "mashan",
    zh: "马善政楷书",
    en: "Ma Shan Zheng",
  },
  {
    family: "江城圆体",
    file: "jiangcheng",
    zh: "江城圆体",
    en: "Jiangcheng Rounded",
  },
  {
    family: "站酷庆科黄油体",
    file: "huangyou",
    zh: "站酷庆科黄油体",
    en: "ZCOOL QingKe HuangYou",
  },
  { family: "未来荧黑", file: "glow", zh: "未来荧黑", en: "Glow Sans" },
  { family: "朱雀仿宋", file: "zhuque", zh: "朱雀仿宋", en: "Zhuque FangSong" },
  {
    family: "站酷快乐体",
    file: "kuaile",
    zh: "站酷快乐体",
    en: "ZCOOL KuaiLe",
  },

  {
    family: "思源黑体",
    file: "notosans",
    zh: "思源黑体 · 正文",
    en: "Source Han Sans",
  },
  {
    family: "思源黑体 Heavy",
    file: "notosans-heavy",
    zh: "思源黑体 · 特重",
    en: "Source Han Sans Heavy",
  },
  {
    family: "思源宋体 Heavy",
    file: "notoserif-heavy",
    zh: "思源宋体 · 特重",
    en: "Source Han Serif Heavy",
  },
  { family: "得意黑", file: "smiley", zh: "得意黑 · 标题", en: "Smiley Sans" },
  {
    family: "霞鹜文楷",
    file: "wenkai",
    zh: "霞鹜文楷 · 手写",
    en: "LXGW WenKai",
  },
  { family: "Inter", file: "inter", zh: "Inter · 无衬线", en: "Inter" },
  {
    family: "DM Serif Display",
    file: "dmserif",
    zh: "DM Serif · 衬线",
    en: "DM Serif Display",
  },
  { family: "Bebas Neue", file: "bebas", zh: "Bebas · 窄体", en: "Bebas Neue" },
  {
    family: "Space Grotesk",
    file: "spacegrotesk",
    zh: "Space Grotesk · 科技",
    en: "Space Grotesk",
  },
  {
    family: "JetBrains Mono",
    file: "jetbrains",
    zh: "JetBrains · 等宽",
    en: "JetBrains Mono",
  },
] as const;
const loads = new Map<string, Promise<void>>();
export function loadPosterFont(family: string) {
  const font = POSTER_FONTS.find((entry) => entry.family === family);
  if (!font) return Promise.resolve();
  if (!loads.has(family)) {
    const face = new FontFace(
      family,
      `url("/poster-fonts/${font.file}.${font.file === "douyin" ? "ttf" : "woff2"}")`,
    );
    const promise = face
      .load()
      .then((loaded) => {
        window.document.fonts.add(loaded);
      })
      .catch((error) => {
        loads.delete(family);
        throw error;
      });
    loads.set(family, promise);
  }
  return loads.get(family)!;
}
export const loadDesignFonts = (zh: boolean) =>
  Promise.all(
    (zh
      ? [
          "思源黑体",
          "思源黑体 Heavy",
          "思源宋体",
          "思源宋体 Heavy",
          "得意黑",
          "霞鹜文楷",
          "抖音美好体",
          "马善政楷书",
          "江城圆体",
          "站酷庆科黄油体",
          "未来荧黑",
          "朱雀仿宋",
          "站酷快乐体",
          "DM Serif Display",
          "Anton",
        ]
      : ["Inter", "DM Serif Display", "Bebas Neue", "Space Grotesk"]
    ).map(loadPosterFont),
  );
