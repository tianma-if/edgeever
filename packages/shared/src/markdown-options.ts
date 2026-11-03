import { Marked, Tokenizer, type marked } from "marked";

const preserveImageLabelEscapes = <T extends ReturnType<Tokenizer["reflink"]>>(token: T, tokenizer: Tokenizer): T => {
  if (token?.type !== "link" || !token.raw.includes("![")) return token;
  const label = [tokenizer.rules.inline.link, tokenizer.rules.inline.reflink, tokenizer.rules.inline.nolink]
    .map(rule => rule.exec(token.raw)?.[1]).find(value => value !== undefined);
  if (!label || !(label.includes("\\[") || label.includes("\\]"))) return token;
  // Marked unescapes the outer label before lexing it, which can turn an
  // escaped image bracket into a delimiter. Re-lex only that matched label.
  const inLink = tokenizer.lexer.state.inLink;
  tokenizer.lexer.state.inLink = true;
  try { token.tokens = tokenizer.lexer.inlineTokens(label); }
  finally { tokenizer.lexer.state.inLink = inLink; }
  return token;
};

/** EdgeEver uses double tildes for strike; single tildes belong to prose. */
// TipTap types the injected instance as its callable singleton, but uses the
// Marked class's Lexer/use API. Each consumer owns its tokenizer registrations.
export const createEdgeEverMarked = () => new Marked({
  gfm: true,
  tokenizer: {
    link(src) {
      return preserveImageLabelEscapes(Tokenizer.prototype.link.call(this, src), this);
    },
    reflink(src, links) {
      return preserveImageLabelEscapes(Tokenizer.prototype.reflink.call(this, src, links), this);
    },
    del(src: string) {
      // undefined rejects this token; false delegates to marked's tokenizer.
      if (/^~(?!~)/.test(src)) return undefined;
      return false;
    },
  },
  hooks: {
    emStrongMask(src: string) {
      // Only change marked's scan copy, keeping offsets and original text intact.
      // Otherwise a lone tilde inside ~~a~b~~ can hide its real closing delimiter.
      return src.replace(/(?<!~)~(?!~)/g, "a");
    },
  },
}) as unknown as typeof marked;
