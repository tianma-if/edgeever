import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { Link2 } from "lucide-react";
import { createMemoLinkHref, type MemoSummary } from "@edgeever/shared";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME,
} from "@/components/ui/command";

export type NoteLinkSuggestionLabels = {
  menu: string;
  empty: string;
  close: string;
  untitled: string;
};

type NoteLinkSuggestionProps = SuggestionProps<MemoSummary, MemoSummary> & {
  labels: NoteLinkSuggestionLabels;
};

export type NoteLinkSuggestionHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const noteLinkSuggestionPluginKey = new PluginKey("edgeever-note-link-suggestion");

export const filterNoteLinkSuggestions = (items: MemoSummary[], currentMemoId: string | null) =>
  items.filter((memo) => memo.id !== currentMemoId && !memo.isDeleted);

export const NoteLinkSuggestion = forwardRef<NoteLinkSuggestionHandle, NoteLinkSuggestionProps>(
  ({ command, items, labels }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const selectedItem = items[Math.min(selectedIndex, Math.max(0, items.length - 1))];

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (!items.length) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex((current) => (current + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((current) => (current + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          command(items[Math.min(selectedIndex, items.length - 1)]);
          return true;
        }
        return false;
      },
    }), [command, items, selectedIndex]);

    return (
      <Command
        aria-label={labels.menu}
        className="w-[min(28rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 shadow-2xl ring-1 ring-slate-950/5"
        shouldFilter={false}
        value={selectedItem?.id}
        onValueChange={(value) => {
          const index = items.findIndex((item) => item.id === value);
          if (index >= 0) setSelectedIndex(index);
        }}
      >
        <CommandList className="max-h-[min(22rem,55dvh)] p-1.5">
          <CommandEmpty>{labels.empty}</CommandEmpty>
          <CommandGroup>
            {items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                className={COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME}
                onMouseDown={(event) => event.preventDefault()}
                onSelect={() => command(item)}
              >
                <Link2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">{item.title || labels.untitled}</span>
                <span className="max-w-40 truncate text-xs text-slate-400">{item.excerpt}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
          <span>↑↓ · Enter</span>
          <span>{labels.close} · Esc</span>
        </div>
      </Command>
    );
  },
);
NoteLinkSuggestion.displayName = "NoteLinkSuggestion";

export const insertSuggestedNoteLink = ({
  editor,
  item,
  labels,
  range,
}: {
  editor: Editor;
  item: MemoSummary;
  labels: NoteLinkSuggestionLabels;
  range: Range;
}) => {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({
      type: "text",
      text: item.title || labels.untitled,
      marks: [{
        type: "link",
        attrs: { href: createMemoLinkHref(item.id), class: "edgeever-note-link" },
      }],
    })
    .run();
};

export const createNoteLinkSuggestionExtension = ({
  getCurrentMemoId,
  getLabels,
  searchMemos,
}: {
  getCurrentMemoId: () => string | null;
  getLabels: () => NoteLinkSuggestionLabels;
  searchMemos: (query: string) => Promise<MemoSummary[]>;
}) => Extension.create({
  name: "edgeeverNoteLinkSuggestion",
  addProseMirrorPlugins() {
    return [Suggestion<MemoSummary, MemoSummary>({
      editor: this.editor,
      pluginKey: noteLinkSuggestionPluginKey,
      char: "@",
      allowSpaces: true,
      allowedPrefixes: null,
      placement: "bottom-start",
      offset: { mainAxis: 6 },
      decorationClass: "edgeever-note-link-query",
      allow: ({ state, range }) => {
        const position = state.doc.resolve(range.from);
        return this.editor.isEditable && position.parent.type.name === "paragraph";
      },
      items: async ({ query }) => {
        const currentMemoId = getCurrentMemoId();
        const memos = await searchMemos(query);
        return filterNoteLinkSuggestions(memos, currentMemoId);
      },
      command: ({ editor, range, props }) => insertSuggestedNoteLink({
        editor,
        item: props,
        labels: getLabels(),
        range,
      }),
      render: () => {
        let renderer: ReactRenderer<NoteLinkSuggestionHandle, NoteLinkSuggestionProps> | null = null;
        let unmount: (() => void) | null = null;
        return {
          onStart: (props) => {
            renderer = new ReactRenderer(NoteLinkSuggestion, {
              editor: props.editor,
              props: { ...props, labels: getLabels() },
            });
            unmount = props.mount(renderer.element);
          },
          onUpdate: (props) => renderer?.updateProps({ ...props, labels: getLabels() }),
          onKeyDown: (props) => renderer?.ref?.onKeyDown(props) ?? false,
          onExit: () => {
            unmount?.();
            renderer?.destroy();
            unmount = null;
            renderer = null;
          },
        };
      },
    })];
  },
});
