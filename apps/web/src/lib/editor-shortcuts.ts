import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { wrapInList } from "@tiptap/pm/schema-list";

const TAB_DELEGATED_NODE_TYPES = new Set([
  "listItem",
  "taskItem",
  "tableCell",
  "tableHeader",
]);

const hasDelegatedTabAncestor = (state: EditorState, position: number) => {
  const resolved = state.doc.resolve(position);
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    if (TAB_DELEGATED_NODE_TYPES.has(resolved.node(depth).type.name)) {
      return true;
    }
  }
  return false;
};

const selectedTextBlockStarts = (state: EditorState) => {
  const { from, to } = state.selection;
  const starts: number[] = [];
  const rangeEnd = Math.max(from, to - 1);

  state.doc.nodesBetween(from, rangeEnd, (node, position) => {
    if (!node.isTextblock) {
      return true;
    }
    starts.push(position + 1);
    return false;
  });

  return starts;
};

/**
 * Handles Tab as text indentation while leaving structural contexts to
 * Tiptap's list and table keymaps.
 */
export const applyPlainTextTab = (
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  shiftKey = false,
) => {
  const { selection } = state;
  if (
    !selection.$from.parent.isTextblock
    || !selection.$to.parent.isTextblock
    || hasDelegatedTabAncestor(state, selection.from)
    || hasDelegatedTabAncestor(state, selection.to)
  ) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  if (selection.empty) {
    if (!shiftKey) {
      dispatch(state.tr.insertText("\t", selection.from));
      return true;
    }

    const blockStart = selection.$from.start();
    const precedingCharacter = selection.from > blockStart
      ? state.doc.textBetween(selection.from - 1, selection.from)
      : "";
    if (precedingCharacter === "\t") {
      dispatch(state.tr.delete(selection.from - 1, selection.from));
      return true;
    }

    if (state.doc.textBetween(blockStart, blockStart + 1) === "\t") {
      dispatch(state.tr.delete(blockStart, blockStart + 1));
    }
    return true;
  }

  const blockStarts = selectedTextBlockStarts(state);
  if (blockStarts.some((position) => hasDelegatedTabAncestor(state, position))) {
    return false;
  }

  const transaction = state.tr;
  for (const position of blockStarts.reverse()) {
    if (shiftKey) {
      if (state.doc.textBetween(position, position + 1) === "\t") {
        transaction.delete(position, position + 1);
      }
    } else {
      transaction.insertText("\t", position);
    }
  }
  dispatch(transaction);
  return true;
};

/**
 * Removes the marker from a newly-created empty list item while preserving
 * its visual/content indentation inside the previous item. Typing a list
 * marker in the resulting paragraph then creates a nested list, matching
 * Typora's Backspace workflow.
 */
export const preserveEmptyListIndentOnBackspace = (
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
) => {
  const { selection } = state;
  if (
    !selection.empty
    || selection.$from.parent.type.name !== "paragraph"
    || selection.$from.parent.content.size !== 0
    || selection.$from.parentOffset !== 0
  ) {
    return false;
  }

  let listItemDepth = -1;
  for (let depth = selection.$from.depth - 1; depth > 0; depth -= 1) {
    const nodeName = selection.$from.node(depth).type.name;
    if (nodeName === "listItem" || nodeName === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }

  if (listItemDepth < 1) {
    return false;
  }

  const listDepth = listItemDepth - 1;
  const itemIndex = selection.$from.index(listDepth);
  const currentItem = selection.$from.node(listItemDepth);
  const list = selection.$from.node(listDepth);
  if (
    itemIndex === 0
    || currentItem.childCount !== 1
    || currentItem.firstChild !== selection.$from.parent
  ) {
    return false;
  }

  const previousItem = list.child(itemIndex - 1);
  if (previousItem.type !== currentItem.type) {
    return false;
  }

  if (!dispatch) {
    return true;
  }

  const currentItemStart = selection.$from.before(listItemDepth);
  const previousItemStart = currentItemStart - previousItem.nodeSize;
  const mergedItem = previousItem.copy(previousItem.content.append(currentItem.content));
  const transaction = state.tr.replaceWith(
    previousItemStart,
    currentItemStart + currentItem.nodeSize,
    mergedItem,
  );
  const paragraphCursor = previousItemStart + previousItem.content.size + 2;
  transaction.setSelection(TextSelection.create(transaction.doc, paragraphCursor));
  dispatch(transaction.scrollIntoView());
  return true;
};

/**
 * Turns a direct paragraph below a list item's leading paragraph into a
 * nested list. This is the structural state produced by the Typora-style
 * Backspace behavior above.
 */
export const wrapIndentedParagraphInList = (
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  requestedListType?: string,
) => {
  const { selection } = state;
  if (
    selection.$from.parent.type.name !== "paragraph"
    || selection.$to.parent !== selection.$from.parent
  ) {
    return false;
  }

  let listItemDepth = -1;
  for (let depth = selection.$from.depth - 1; depth > 0; depth -= 1) {
    const nodeName = selection.$from.node(depth).type.name;
    if (nodeName === "listItem" || nodeName === "taskItem") {
      listItemDepth = depth;
      break;
    }
  }

  if (
    listItemDepth < 1
    || selection.$from.index(listItemDepth) === 0
  ) {
    return false;
  }

  const listTypeName = requestedListType ?? selection.$from.node(listItemDepth - 1).type.name;
  const listType = state.schema.nodes[listTypeName];
  return Boolean(listType && wrapInList(listType)(state, dispatch));
};

export const saveAndSyncEditor = async ({
  hasUnsavedChanges,
  save,
  sync,
}: {
  hasUnsavedChanges: boolean;
  save: () => Promise<unknown>;
  sync: () => Promise<unknown>;
}) => {
  if (hasUnsavedChanges) {
    await save();
  }

  await sync();
};

export const getAiSlashCommandStart = ({
  caretPosition,
  insertedText,
  textBefore,
}: {
  caretPosition: number;
  insertedText: string;
  textBefore: string;
}) => {
  if (insertedText.toLowerCase() !== "i" || !/(?:^|\s)\/a$/i.test(textBefore)) {
    return null;
  }

  return caretPosition - 2;
};

export const shouldOpenAiFromSpace = ({
  altKey,
  ctrlKey,
  isComposing,
  isEmptyParagraph,
  key,
  keyCode,
  metaKey,
  repeat,
  selectionEmpty,
  shiftKey,
}: {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  isEmptyParagraph: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  repeat: boolean;
  selectionEmpty: boolean;
  shiftKey: boolean;
}) => key === " "
  && !altKey
  && !ctrlKey
  && !metaKey
  && !shiftKey
  && !repeat
  && !isComposing
  && keyCode !== 229
  && selectionEmpty
  && isEmptyParagraph;

export type HeadingShortcutLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const HEADING_SHORTCUT_TEXT_BLOCKS = new Set(["paragraph", "heading"]);

type HeadingShortcutKeyEvent = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  repeat?: boolean;
};

/**
 * Typora-style heading chords: Mod+1..6 set that heading, Mod+0 sets body text.
 * Shift stays free for the outline shortcut. Alt stays free for TipTap's toggle.
 * The desktop main process mirrors this match for Mod+0 in heading-shortcut.mjs.
 */
export const headingShortcutLevelFromEvent = (
  event: HeadingShortcutKeyEvent,
): HeadingShortcutLevel | null => {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return null;
  if (event.altKey || event.shiftKey) return null;
  if (!event.ctrlKey && !event.metaKey) return null;

  const codeLevel = /^(?:Digit|Numpad)([0-6])$/.exec(event.code ?? "");
  if (codeLevel) return Number(codeLevel[1]) as HeadingShortcutLevel;
  if (/^[0-6]$/.test(event.key)) return Number(event.key) as HeadingShortcutLevel;
  return null;
};

/**
 * Sets every selected paragraph or heading to one level. Other blocks, including
 * code blocks and list-item paragraphs the schema cannot replace, stay put.
 * Pressing the current level again changes nothing.
 */
export const applyHeadingLevelShortcut = (
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  level: HeadingShortcutLevel,
) => {
  const target = level === 0 ? state.schema.nodes.paragraph : state.schema.nodes.heading;
  if (!target) return false;

  const positions: number[] = [];
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) return;
      if (!HEADING_SHORTCUT_TEXT_BLOCKS.has(node.type.name)) return false;
      const nextAttrs = level === 0 ? null : { ...node.attrs, level };
      if (node.hasMarkup(target, nextAttrs)) return false;
      const $pos = state.doc.resolve(pos);
      if (node.type !== target && !$pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, target)) {
        return false;
      }
      positions.push(pos);
      return false;
    });
  }

  if (positions.length === 0) return false;
  if (!dispatch) return true;

  const transaction = state.tr;
  for (const pos of positions) {
    const mapped = transaction.mapping.map(pos);
    const node = transaction.doc.nodeAt(mapped);
    if (!node || !HEADING_SHORTCUT_TEXT_BLOCKS.has(node.type.name)) continue;
    const nextAttrs = level === 0 ? null : { ...node.attrs, level };
    if (node.hasMarkup(target, nextAttrs)) continue;
    transaction.setNodeMarkup(mapped, target, nextAttrs);
  }
  dispatch(transaction.scrollIntoView());
  return true;
};
