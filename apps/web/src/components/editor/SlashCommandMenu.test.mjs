import { describe, expect, test } from "bun:test";
import {
  createSlashCommandItems,
  filterSlashCommandItems,
  formatCurrentDate,
  formatCurrentDateTime,
  formatCurrentTime,
} from "./SlashCommandMenu.tsx";

const labels = {
  menu: "插入功能菜单",
  empty: "没有匹配的功能。",
  close: "关闭菜单",
  groups: { suggested: "建议", basic: "基本区块", insert: "插入" },
  items: {
    ai: "用 AI 处理",
    paragraph: "正文",
    "heading-1": "标题 1",
    "heading-2": "标题 2",
    "heading-3": "标题 3",
    "bullet-list": "无序列表",
    "ordered-list": "有序列表",
    "task-list": "任务清单",
    blockquote: "引用",
    "code-block": "代码块",
    divider: "分割线",
    table: "表格",
    "current-date": "当前日期",
    "current-time": "当前时间",
    "current-date-time": "当前日期和时间",
    attachment: "上传附件",
    "note-link": "引用笔记",
    "external-link": "插入超链接",
  },
};

describe("slash command menu", () => {
  const items = createSlashCommandItems(labels);

  test("shows all commands for a bare slash", () => {
    const unfilteredItems = filterSlashCommandItems(items, "");
    const heading3Index = unfilteredItems.findIndex((item) => item.id === "heading-3");

    expect(unfilteredItems).toHaveLength(18);
    expect(unfilteredItems.slice(heading3Index + 1, heading3Index + 4).map((item) => item.id)).toEqual([
      "current-date",
      "current-time",
      "current-date-time",
    ]);
  });

  test("searches localized labels and aliases", () => {
    expect(filterSlashCommandItems(items, "AI").map((item) => item.id)).toEqual(["ai"]);
    expect(filterSlashCommandItems(items, "待办").map((item) => item.id)).toEqual(["task-list"]);
    expect(filterSlashCommandItems(items, "h2").map((item) => item.id)).toEqual(["heading-2"]);
    expect(filterSlashCommandItems(items, "今天").map((item) => item.id)).toEqual(["current-date"]);
    expect(filterSlashCommandItems(items, "timestamp").map((item) => item.id)).toEqual(["current-date-time"]);
  });

  test("assigns every item a unique lowercase slash command alias", () => {
    expect(items.map((item) => item.command)).toEqual([
      "ai",
      "text",
      "h1",
      "h2",
      "h3",
      "date",
      "time",
      "datetime",
      "bullet",
      "numbered",
      "task",
      "quote",
      "code",
      "divider",
      "table",
      "upload",
      "note",
      "link",
    ]);
    expect(items.every((item) => /^[a-z][a-z0-9]*$/.test(item.command))).toBe(true);
    expect(new Set(items.map((item) => item.command)).size).toBe(items.length);
    expect(filterSlashCommandItems(items, "table").map((item) => item.id)).toEqual(["table"]);
    expect(filterSlashCommandItems(items, "task").map((item) => item.id)).toEqual(["task-list"]);
  });

  test("formats local date and time as stable static text", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(formatCurrentDate(date)).toBe("2026-01-02");
    expect(formatCurrentTime(date)).toBe("03:04");
    expect(formatCurrentDateTime(date)).toBe("2026-01-02 03:04");
  });
});
