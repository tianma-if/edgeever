import { mergeAttributes } from "@tiptap/core";
import { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";

export const TEXT_COLORS = [
  { name: "gray", text: "#787774", background: "#f1f1ef", darkText: "#b8b7b3", darkBackground: "#373735" },
  { name: "brown", text: "#9f6b53", background: "#f4eeee", darkText: "#c99b82", darkBackground: "#493a34" },
  { name: "orange", text: "#c76b21", background: "#fbecdd", darkText: "#e6a064", darkBackground: "#523b28" },
  { name: "yellow", text: "#9b7800", background: "#fbf3db", darkText: "#dfc36a", darkBackground: "#4f462b" },
  { name: "green", text: "#448361", background: "#edf3ec", darkText: "#8dc5a5", darkBackground: "#2d4437" },
  { name: "blue", text: "#337ea9", background: "#e7f3f8", darkText: "#82bce0", darkBackground: "#293f50" },
  { name: "purple", text: "#9065b0", background: "#f4f0f7", darkText: "#bd9cdb", darkBackground: "#443451" },
  { name: "pink", text: "#b34c82", background: "#f9eef3", darkText: "#e29cbe", darkBackground: "#503346" },
  { name: "red", text: "#c94343", background: "#fce9e7", darkText: "#ec9691", darkBackground: "#543432" },
] as const;

// Markdown is also parsed in Workers, where there is no DOM. Keep the portable
// syntax deliberately small: two CSS color properties, each a hex value.
export const normalizeTextColor = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) return color;
  if (/^#[\da-f]{3}$/.test(color)) return `#${color.slice(1).split("").map((digit) => digit.repeat(2)).join("")}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color);
  if (!rgb || rgb.slice(1).some((part) => Number(part) > 255)) return null;
  return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
};

const readColors = (attributes: string) => {
  const style = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
  const values: Record<string, string> = {};
  for (const declaration of (style?.[1] ?? style?.[2] ?? "").split(";")) {
    const [property, value] = declaration.split(":");
    const color = normalizeTextColor(value);
    if (color && property.trim().toLowerCase() === "color") values.color = color;
    if (color && property.trim().toLowerCase() === "background-color") values.backgroundColor = color;
  }
  return values;
};

export const EdgeEverTextStyle = TextStyle.extend({
  renderHTML({ mark, HTMLAttributes }) {
    const color = normalizeTextColor(mark.attrs.color);
    const background = normalizeTextColor(mark.attrs.backgroundColor);
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      "data-ee-text-color": TEXT_COLORS.find((item) => item.text === color)?.name,
      "data-ee-background-color": TEXT_COLORS.find((item) => item.background === background)?.name,
    }), 0];
  },
  renderMarkdown(node, helpers) {
    const color = normalizeTextColor(node.attrs?.color);
    const background = normalizeTextColor(node.attrs?.backgroundColor);
    const style = [color && `color: ${color}`, background && `background-color: ${background}`].filter(Boolean).join("; ");
    const content = helpers.renderChildren(node.content ?? []);
    return style ? `<span style="${style}">${content}</span>` : content;
  },
  parseMarkdown(token, helpers) {
    // A nested span overrides individual properties rather than creating two
    // competing textStyle marks (ProseMirror only keeps one of each mark type).
    return helpers.parseInline(token.tokens ?? []).map((node) => ({
      ...node,
      marks: [
        ...(node.marks ?? []).filter((mark) => mark.type !== "textStyle"),
        { type: "textStyle", attrs: {
          ...token.colors,
          ...(node.marks ?? []).find((mark) => mark.type === "textStyle")?.attrs,
        } },
      ],
    }));
  },
  markdownTokenizer: {
    name: "textStyle",
    level: "inline",
    start: (source) => source.search(/<span\b/i),
    tokenize(source, _tokens, lexer) {
      const opening = /^<span\b([^>]*)>/i.exec(source);
      if (!opening) return undefined;
      const colors = readColors(opening[1]);
      if (!Object.keys(colors).length) return undefined;
      const tags = /<\/?span\b[^>]*>/gi;
      tags.lastIndex = opening[0].length;
      let depth = 1;
      for (let tag = tags.exec(source); tag; tag = tags.exec(source)) {
        depth += tag[0].startsWith("</") ? -1 : 1;
        if (depth === 0) {
          return {
            type: "textStyle", raw: source.slice(0, tags.lastIndex), colors,
            tokens: lexer.inlineTokens(source.slice(opening[0].length, tag.index)),
          };
        }
      }
      return undefined;
    },
  },
});

export const createTextColorExtensions = () => [EdgeEverTextStyle, Color, BackgroundColor];
