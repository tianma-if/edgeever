import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

// TipTap's code mark only converts when the closing backtick is the character
// just typed. A pair typed first, with the word filled in afterwards, stays
// plain text (#660). Keep accepting characters at the end of that span, and
// finish it on whitespace so the following sentence is not code.
type InlineCodeCaret = { position: number | null };

const inlineCodeInputKey = new PluginKey<InlineCodeCaret>("edgeeverInlineCodeInput");

type TextInputView = {
  composing: boolean;
  state: EditorState;
  dispatch: (transaction: Transaction) => void;
};

const textblock = (state: EditorState, pos: number) => {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  for (let index = 0; index < parent.childCount; index += 1) {
    if (!parent.child(index).isText) return null;
  }
  return { $pos, parentStart: $pos.start() };
};

const endsAtCode = (state: EditorState, pos: number) => {
  const mark = state.schema.marks.code;
  const before = state.doc.resolve(pos).nodeBefore;
  return Boolean(mark && before && mark.isInSet(before.marks));
};

const placeCaret = (transaction: Transaction, pos: number) => {
  transaction.setSelection(TextSelection.create(transaction.doc, pos));
};

const continueInlineCode = (view: TextInputView, from: number, text: string) => {
  const { state } = view;
  const mark = state.schema.marks.code;
  if (!mark) return false;
  const whitespace = /^\s+$/.test(text);
  const transaction = whitespace
    ? state.tr.insert(from, state.schema.text(text))
    : state.tr.insert(from, state.schema.text(text, [mark.create()]));
  const caret = from + text.length;
  placeCaret(transaction, caret);
  if (whitespace) transaction.setStoredMarks([]);
  transaction.setMeta(inlineCodeInputKey, { position: whitespace ? null : caret });
  closeHistory(transaction);
  view.dispatch(transaction);
  return true;
};

// `before` already includes `inserted`. An empty insert means the word is already
// between the backticks (an IME commit that landed before this handler).
const backtickWrap = (before: string, after: string, inserted: string) => {
  if (/[`\r\n\0]/.test(inserted)) return null;
  const match = /`([^`]+)$/.exec(before);
  if (!match) return null;
  const openIndex = match.index;
  if (openIndex > 0 && before[openIndex - 1] === "`") return null;
  if (openIndex >= before.length - inserted.length) return null;
  if (!after.startsWith("`") || after.startsWith("``")) return null;
  return { openIndex, content: match[1] ?? "" };
};

const convertBacktickWrap = (view: TextInputView, from: number, inserted: string) => {
  const { state } = view;
  const mark = state.schema.marks.code;
  const block = textblock(state, from);
  if (!mark || !block) return false;
  if (mark.isInSet(block.$pos.marks()) && block.$pos.textOffset > 0) return false;
  const parentOffset = from - block.parentStart;
  const existing = block.$pos.parent.textBetween(0, block.$pos.parent.content.size, "\n", "\0");
  if (existing.includes("\0")) return false;
  const before = existing.slice(0, parentOffset) + inserted;
  const after = existing.slice(parentOffset);
  const wrap = backtickWrap(before, after, inserted);
  if (!wrap?.content) return false;

  const openPos = block.parentStart + wrap.openIndex;
  const transaction = state.tr.replaceWith(
    openPos,
    from + 1,
    state.schema.text(wrap.content, [mark.create()]),
  );
  const caret = openPos + wrap.content.length;
  placeCaret(transaction, caret);
  transaction.setMeta(inlineCodeInputKey, { position: caret });
  closeHistory(transaction);
  view.dispatch(transaction);
  return true;
};

const handleInlineCodeTextInput = (view: TextInputView, from: number, to: number, text: string) => {
  if (view.composing || !text || from !== to) return false;
  const pending = inlineCodeInputKey.getState(view.state);
  if (pending?.position === from && endsAtCode(view.state, from) && !text.includes("\n") && !text.includes("\r")) {
    return continueInlineCode(view, from, text);
  }
  return convertBacktickWrap(view, from, text);
};

export const EdgeEverInlineCodeInput = Extension.create({
  name: "edgeeverInlineCodeInput",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: inlineCodeInputKey,
        state: {
          init: (): InlineCodeCaret => ({ position: null }),
          apply: (transaction, value): InlineCodeCaret => {
            const meta = transaction.getMeta(inlineCodeInputKey) as InlineCodeCaret | undefined;
            if (meta) return meta;
            if (value.position === null) return value;
            if (!transaction.selection.empty) return { position: null };
            const position = transaction.mapping.map(value.position);
            return transaction.selection.from === position ? { position } : { position: null };
          },
        },
        props: {
          handleTextInput: (view, from, to, text) => handleInlineCodeTextInput(view, from, to, text),
          // Some IME commits land in the document before the input handler sees them.
          handleDOMEvents: {
            compositionend: (view) => {
              setTimeout(() => {
                if (!view.dom.isConnected) return;
                const { from, empty } = view.state.selection;
                if (!empty) return;
                convertBacktickWrap(view, from, "");
              }, 0);
              return false;
            },
          },
        },
      }),
    ];
  },
});
