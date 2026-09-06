import { forwardRef, useEffect, useImperativeHandle, useState, type ComponentType } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import {
  BetweenHorizontalStart,
  Bot,
  Braces,
  CalendarClock,
  CalendarDays,
  Clock3,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
  Table2,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
  COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME,
} from "@/components/ui/command";

export type SlashCommandId =
  | "ai"
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"
  | "divider"
  | "table"
  | "current-date"
  | "current-time"
  | "current-date-time"
  | "attachment"
  | "note-link"
  | "external-link";

type SlashCommandGroup = "suggested" | "basic" | "insert";
type SlashCommandIcon = ComponentType<{ className?: string }>;

export type SlashCommandLabels = {
  menu: string;
  empty: string;
  close: string;
  groups: Record<SlashCommandGroup, string>;
  items: Record<SlashCommandId, string>;
};

export type SlashCommandActions = {
  openAi: () => void;
  openAttachmentPicker: () => void;
  openExternalLinkPicker: () => void;
  openNoteLinkPicker: () => void;
};

export type SlashCommandItem = {
  command: string;
  id: SlashCommandId;
  group: SlashCommandGroup;
  icon: SlashCommandIcon;
  keywords: string[];
  label: string;
};

const slashCommandPluginKey = new PluginKey("edgeever-slash-command");

const padDatePart = (value: number) => String(value).padStart(2, "0");

export const formatCurrentDate = (date: Date) =>
  `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

export const formatCurrentTime = (date: Date) =>
  `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;

export const formatCurrentDateTime = (date: Date) =>
  `${formatCurrentDate(date)} ${formatCurrentTime(date)}`;

export const createSlashCommandItems = (labels: SlashCommandLabels): SlashCommandItem[] => [
  { id: "ai", command: "ai", group: "suggested", icon: Bot, label: labels.items.ai, keywords: ["assistant", "人工智能", "智能", "写作"] },
  { id: "paragraph", command: "text", group: "basic", icon: Pilcrow, label: labels.items.paragraph, keywords: ["paragraph", "正文", "文本"] },
  { id: "heading-1", command: "h1", group: "basic", icon: Heading1, label: labels.items["heading-1"], keywords: ["heading", "标题"] },
  { id: "heading-2", command: "h2", group: "basic", icon: Heading2, label: labels.items["heading-2"], keywords: ["heading", "标题"] },
  { id: "heading-3", command: "h3", group: "basic", icon: Heading3, label: labels.items["heading-3"], keywords: ["heading", "标题"] },
  { id: "current-date", command: "date", group: "basic", icon: CalendarDays, label: labels.items["current-date"], keywords: ["today", "日期", "今天"] },
  { id: "current-time", command: "time", group: "basic", icon: Clock3, label: labels.items["current-time"], keywords: ["now", "时间", "现在"] },
  { id: "current-date-time", command: "datetime", group: "basic", icon: CalendarClock, label: labels.items["current-date-time"], keywords: ["timestamp", "日期时间", "时间戳"] },
  { id: "bullet-list", command: "bullet", group: "basic", icon: List, label: labels.items["bullet-list"], keywords: ["list", "无序", "列表"] },
  { id: "ordered-list", command: "numbered", group: "basic", icon: ListOrdered, label: labels.items["ordered-list"], keywords: ["ordered", "list", "有序", "编号"] },
  { id: "task-list", command: "task", group: "basic", icon: ListTodo, label: labels.items["task-list"], keywords: ["todo", "check", "任务", "待办"] },
  { id: "blockquote", command: "quote", group: "basic", icon: Quote, label: labels.items.blockquote, keywords: ["引用"] },
  { id: "code-block", command: "code", group: "basic", icon: Braces, label: labels.items["code-block"], keywords: ["代码"] },
  { id: "divider", command: "divider", group: "insert", icon: BetweenHorizontalStart, label: labels.items.divider, keywords: ["rule", "分割", "分隔"] },
  { id: "table", command: "table", group: "insert", icon: Table2, label: labels.items.table, keywords: ["表格"] },
  { id: "attachment", command: "upload", group: "insert", icon: FileUp, label: labels.items.attachment, keywords: ["file", "attachment", "文件", "上传", "附件"] },
  { id: "note-link", command: "note", group: "insert", icon: Link, label: labels.items["note-link"], keywords: ["link", "memo", "笔记", "引用"] },
  { id: "external-link", command: "link", group: "insert", icon: Link, label: labels.items["external-link"], keywords: ["url", "web", "链接", "网址"] },
];

export const filterSlashCommandItems = (items: SlashCommandItem[], query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => [item.command, item.label, item.id, ...item.keywords]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
};

type SlashCommandMenuProps = SuggestionProps<SlashCommandItem, SlashCommandItem> & {
  labels: SlashCommandLabels;
};

export type SlashCommandMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const GROUP_ORDER: SlashCommandGroup[] = ["suggested", "basic", "insert"];

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
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
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 shadow-2xl ring-1 ring-slate-950/5"
        shouldFilter={false}
        value={selectedItem?.id}
        onValueChange={(value) => {
          const index = items.findIndex((item) => item.id === value);
          if (index >= 0) setSelectedIndex(index);
        }}
      >
        <CommandList className="max-h-[min(24rem,60dvh)] p-1.5">
          <CommandEmpty>{labels.empty}</CommandEmpty>
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            return groupItems.length ? (
              <CommandGroup key={group} heading={labels.groups[group]}>
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      keywords={item.keywords}
                      className={COMMAND_ITEM_STRONG_SELECTED_CLASS_NAME}
                      onMouseDown={(event) => event.preventDefault()}
                      onSelect={() => command(item)}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <CommandShortcut className="font-mono tracking-normal">/{item.command}</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null;
          })}
        </CommandList>
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
          <span>↑↓ · Enter</span>
          <span>{labels.close} · Esc</span>
        </div>
      </Command>
    );
  },
);
SlashCommandMenu.displayName = "SlashCommandMenu";

const runSlashCommand = ({
  actions,
  editor,
  item,
  range,
}: {
  actions: SlashCommandActions;
  editor: Editor;
  item: SlashCommandItem;
  range: Range;
}) => {
  const chain = editor.chain().focus().deleteRange(range);
  switch (item.id) {
    case "ai":
      chain.run();
      window.requestAnimationFrame(actions.openAi);
      break;
    case "paragraph": chain.setParagraph().run(); break;
    case "heading-1": chain.setHeading({ level: 1 }).run(); break;
    case "heading-2": chain.setHeading({ level: 2 }).run(); break;
    case "heading-3": chain.setHeading({ level: 3 }).run(); break;
    case "bullet-list": chain.toggleBulletList().run(); break;
    case "ordered-list": chain.toggleOrderedList().run(); break;
    case "task-list": chain.toggleTaskList().run(); break;
    case "blockquote": chain.toggleBlockquote().run(); break;
    case "code-block": chain.setCodeBlock().run(); break;
    case "divider": chain.setHorizontalRule().run(); break;
    case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
    case "current-date": chain.insertContent(formatCurrentDate(new Date())).run(); break;
    case "current-time": chain.insertContent(formatCurrentTime(new Date())).run(); break;
    case "current-date-time": chain.insertContent(formatCurrentDateTime(new Date())).run(); break;
    case "attachment":
      chain.run();
      window.requestAnimationFrame(actions.openAttachmentPicker);
      break;
    case "note-link":
      chain.run();
      window.requestAnimationFrame(actions.openNoteLinkPicker);
      break;
    case "external-link":
      chain.run();
      window.requestAnimationFrame(actions.openExternalLinkPicker);
      break;
  }
};

export const createSlashCommandExtension = ({
  actions,
  getLabels,
}: {
  actions: SlashCommandActions;
  getLabels: () => SlashCommandLabels;
}) => Extension.create({
  name: "edgeeverSlashCommand",
  addProseMirrorPlugins() {
    const initialItems = createSlashCommandItems(getLabels());
    return [Suggestion<SlashCommandItem, SlashCommandItem>({
      editor: this.editor,
      pluginKey: slashCommandPluginKey,
      char: "/",
      allowedPrefixes: [" "],
      placement: "bottom-start",
      offset: { mainAxis: 6 },
      decorationClass: "edgeever-slash-command-query",
      initialItems,
      allow: ({ state, range }) => {
        const position = state.doc.resolve(range.from);
        return this.editor.isEditable && position.parent.type.name === "paragraph";
      },
      items: ({ query }) => filterSlashCommandItems(createSlashCommandItems(getLabels()), query),
      command: ({ editor, range, props }) => runSlashCommand({ actions, editor, item: props, range }),
      render: () => {
        let renderer: ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps> | null = null;
        let unmount: (() => void) | null = null;
        return {
          onStart: (props) => {
            renderer = new ReactRenderer(SlashCommandMenu, {
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
