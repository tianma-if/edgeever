import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { MemoSummary } from "@edgeever/shared";
import { remapMemoIdsInLists, sortDesktopTitleMemoSummaries, updateMemoSummaryInLists, type MemoListQueryData } from "../apps/web/src/lib/memo-list-cache";

const memo = (overrides: Partial<MemoSummary> = {}): MemoSummary => ({
  id: "memo-apple",
  notebookId: "nb-inbox",
  title: "Apple developer enrollment",
  excerpt: "Apple Developer Program",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-07-16T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const queryData = (pages: MemoSummary[][], totalCount = pages.flat().length): MemoListQueryData => ({
  pages: pages.map((memos) => ({ memos, totalCount, nextCursor: null })),
  pageParams: pages.map(() => null),
});

describe("memo list cache updates", () => {
  test("keeps an edited note in an active full-text search until the server refetch resolves membership", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "Apple", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[memo()]]));

    updateMemoSummaryInLists(queryClient, memo({ title: "Updated title", revision: 2 }));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    expect(cached?.pages[0]?.memos).toHaveLength(1);
    expect(cached?.pages[0]?.memos[0]?.title).toBe("Updated title");
    expect(cached?.pages[0]?.memos[0]?.revision).toBe(2);
  });

  test("does not optimistically insert an unseen note into a full-text search", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "Apple", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[]], 0));

    updateMemoSummaryInLists(queryClient, memo());

    expect(queryClient.getQueryData<MemoListQueryData>(queryKey)?.pages[0]?.memos).toEqual([]);
  });

  test("deduplicates the same note ID if overlapping infinite-query pages contain it", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[memo()], [memo({ revision: 2 })]], 1));

    updateMemoSummaryInLists(queryClient, memo({ revision: 3 }));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    const flattened = cached?.pages.flatMap((page) => page.memos) ?? [];
    expect(flattened).toHaveLength(1);
    expect(flattened[0]?.revision).toBe(3);
    expect(cached?.pages[0]?.totalCount).toBe(1);
  });

  test("replaces a temporary create id so the list does not show two empty notes", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", "nb-inbox", "", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([
      [memo({ id: "memo_remote_1", title: "", excerpt: "" }), memo({ id: "memo_local_1", title: "", excerpt: "" })],
    ], 2));

    remapMemoIdsInLists(queryClient, new Map([["memo_local_1", "memo_remote_1"]]));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    const flattened = cached?.pages.flatMap((page) => page.memos) ?? [];
    expect(flattened).toHaveLength(1);
    expect(flattened[0]?.id).toBe("memo_remote_1");
    expect(cached?.pages[0]?.totalCount).toBe(1);
  });

  test("reorders a cached list from Z to A without reversing the id tie break", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "", "all", "title-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[
      memo({ id: "memo-b", title: "Alpha" }),
      memo({ id: "memo-a", title: "Alpha" }),
      memo({ id: "memo-z", title: "Zulu" }),
    ]]));

    updateMemoSummaryInLists(queryClient, memo({ id: "memo-z", title: "Zulu", revision: 2 }));

    const titles = queryClient.getQueryData<MemoListQueryData>(queryKey)?.pages[0]?.memos.map((item) => item.id);
    expect(titles).toEqual(["memo-z", "memo-a", "memo-b"]);
  });

  test("removes a note when an edit no longer matches the selected exact tag", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "", "all", "updated-desc", [], "demo"] as const;
    queryClient.setQueryData(queryKey, queryData([[memo({ tags: ["Demo"] })]], 1));

    updateMemoSummaryInLists(queryClient, memo({ tags: ["demo-extra"], revision: 2 }));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    expect(cached?.pages[0]?.memos).toEqual([]);
    expect(cached?.pages[0]?.totalCount).toBe(0);
  });
});

describe("desktop title list cache ordering (#750)", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sidecarSource = readFileSync(new URL("../crates/desktop-sidecar/src/memo.rs", import.meta.url), "utf8");

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { edgeeverDesktop: { isAvailable: true } },
    });
  });

  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  // Use the actual sidecar ORDER BY as the oracle, including its title fallback
  // and tie breaks, rather than copying the renderer's comparator into tests.
  const desktopOrder = (memos: MemoSummary[], sort: "title-asc" | "title-desc") => {
    const order = sidecarSource.match(new RegExp(`Some\\("${sort}"\\) => \\{\\s*"([^"]+)"`))?.[1];
    expect(order).toBeDefined();
    const database = new Database(":memory:");
    try {
      database.exec("CREATE TABLE memos (id TEXT, title TEXT, excerpt TEXT, updated_at TEXT)");
      const insert = database.prepare("INSERT INTO memos VALUES (?, ?, ?, ?)");
      for (const item of memos) insert.run(item.id, item.title, item.excerpt, item.updatedAt);
      const byId = new Map(memos.map((item) => [item.id, item]));
      return database.query<{ id: string }, []>(`SELECT m.id FROM memos m ORDER BY ${order}`).all()
        .map((row) => byId.get(row.id)!);
    } finally {
      database.close();
    }
  };

  for (const sort of ["title-asc", "title-desc"] as const) {
    test(`keeps distinct Chinese titles in sidecar order after a body-only save (${sort})`, () => {
      const queryClient = new QueryClient();
      const queryKey = ["memos", "notebook", "nb-inbox", "", "all", sort] as const;
      const notes = ["中文笔记", "笔记整理", "阿尔法"].map((title, index) => memo({ id: `memo-${index}`, title }));
      const ordered = desktopOrder(notes, sort);
      queryClient.setQueryData(queryKey, queryData([ordered]));

      updateMemoSummaryInLists(queryClient, { ...notes[2]!, excerpt: "Only the body changed", revision: 2, updatedAt: "2026-11-01T12:00:00.000Z" });

      const cached = queryClient.getQueryData<MemoListQueryData>(queryKey)!;
      expect(cached.pages[0]!.memos.map((item) => item.id)).toEqual(ordered.map((item) => item.id));
      expect(cached.pages[0]!.memos.find((item) => item.id === "memo-2")?.excerpt).toBe("Only the body changed");
      queryClient.clear();
    });

    test(`matches SQLite case, Unicode, empty titles and equal-title tie breaks (${sort})`, () => {
      const queryClient = new QueryClient();
      const queryKey = ["memos", "notebook", "nb-inbox", "", "all", sort] as const;
      const notes = [null, "", " Alpha ", "alpha", "ALPHA", "Éclair", "éclair", "\uE000", "😀", "Alpha", "\0a", "\0b"].map((title, index) => memo({
        id: `memo-${index}`, title, excerpt: `Excerpt ${index}`, isPinned: index === 6,
      }));
      const updated = { ...notes[3]!, updatedAt: "2026-11-01T12:00:00.000Z", revision: 2 };
      queryClient.setQueryData(queryKey, queryData([desktopOrder(notes, sort)]));

      updateMemoSummaryInLists(queryClient, updated);

      expect(queryClient.getQueryData<MemoListQueryData>(queryKey)!.pages[0]!.memos.map((item) => item.id))
        .toEqual(desktopOrder(notes.map((item) => item.id === updated.id ? updated : item), sort).map((item) => item.id));

      const added = memo({ id: "new-note", title: "阿里" });
      updateMemoSummaryInLists(queryClient, added);
      expect(queryClient.getQueryData<MemoListQueryData>(queryKey)!.pages[0]!.memos.map((item) => item.id))
        .toEqual(desktopOrder([...notes.map((item) => item.id === updated.id ? updated : item), added], sort).map((item) => item.id));
      queryClient.clear();
    });

    test(`keeps SQLite binary ID ties for restored non-ASCII IDs (${sort})`, () => {
      const queryClient = new QueryClient();
      const queryKey = ["memos", "notebook", "nb-inbox", "", "all", sort] as const;
      const notes = ["memo_\uE000", "memo_😀", "memo_a", "memo_A", "memo_a\0z"].map(id => memo({ id, title: "Same title" }));
      queryClient.setQueryData(queryKey, queryData([desktopOrder(notes, sort)]));

      updateMemoSummaryInLists(queryClient, { ...notes[0]!, revision: 2 });

      expect(queryClient.getQueryData<MemoListQueryData>(queryKey)!.pages[0]!.memos.map(item => item.id))
        .toEqual(desktopOrder(notes, sort).map(item => item.id));
      remapMemoIdsInLists(queryClient, new Map([["memo_a", "memo_📝"]]));
      expect(queryClient.getQueryData<MemoListQueryData>(queryKey)!.pages[0]!.memos.map(item => item.id))
        .toEqual(desktopOrder(notes.map(item => item.id === "memo_a" ? { ...item, id: "memo_📝" } : item), sort).map(item => item.id));
      queryClient.clear();
    });

    test(`inserts a new note in the order of all loaded pages without refetching (${sort})`, async () => {
      const queryClient = new QueryClient();
      const queryKey = ["memos", "notebook", "nb-inbox", "", "all", sort] as const;
      const notes = Array.from({ length: 120 }, (_, index) => memo({ id: `memo-${index}`, title: `标题 ${String(index).padStart(3, "0")}` }));
      const loaded = desktopOrder(notes, sort).slice(0, 100);
      const data = queryData([loaded.slice(0, 50), loaded.slice(50)], 120);
      data.pages[0]!.nextCursor = "50";
      data.pages[1]!.nextCursor = "100";
      data.pageParams = [null, "50"];
      let reads = 0;
      const observer = new QueryObserver(queryClient, {
        queryKey, initialData: data, staleTime: Infinity,
        queryFn: async () => { reads++; return data; },
      });
      const unsubscribe = observer.subscribe(() => {});
      try {
        const added = memo({ id: "memo-new", title: sort === "title-asc" ? "标题 075a" : "标题 045a" });
        updateMemoSummaryInLists(queryClient, added);

        const cached = queryClient.getQueryData<MemoListQueryData>(queryKey)!;
        expect(cached.pages.flatMap(page => page.memos.map(item => item.id)))
          .toEqual(desktopOrder([...loaded, added], sort).map(item => item.id));
        expect(cached.pages.map(page => page.memos.length)).toEqual([51, 50]);
        expect(cached.pages.map(page => page.totalCount)).toEqual([121, 121]);
        expect(cached.pages.map(page => page.nextCursor)).toEqual(["50", "100"]);
        expect(cached.pageParams).toEqual([null, "50"]);
        await Promise.resolve();
        expect(reads).toBe(0);
      } finally { unsubscribe(); queryClient.clear(); }
    });

    test(`keeps an edited tail ordered when another page arrives (${sort})`, () => {
      const notes = Array.from({ length: 120 }, (_, index) => memo({ id: `memo-${index}`, title: `标题 ${String(index).padStart(3, "0")}` }));
      const ordered = desktopOrder(notes, sort);
      const tail = { ...ordered[10]!, title: sort === "title-asc" ? "龥 changed tail" : "A changed tail" };
      const changed = notes.map(item => item.id === tail.id ? tail : item);
      const cached = sortDesktopTitleMemoSummaries(ordered.slice(0, 50).map(item => item.id === tail.id ? tail : item), sort);
      const incoming = desktopOrder(changed, sort).slice(50, 100);
      const displayed = [...new Map([...cached, ...incoming].map(item => [item.id, item])).values()];
      const previousIds = displayed.map(item => item.id);

      const sorted = sortDesktopTitleMemoSummaries(displayed, sort);

      expect(sorted.map(item => item.id)).toEqual(desktopOrder(displayed, sort).map(item => item.id));
      expect(sorted.at(-1)?.id).toBe(tail.id);
      expect(displayed.map(item => item.id)).toEqual(previousIds);
      expect(sorted).toHaveLength(displayed.length);
    });

    for (const mutation of ["rename", "remap", "older-timestamp"] as const) {
      test(`does not skip a source note after a prefix ${mutation} sorts beyond the next-page cursor (${sort})`, () => {
        const queryClient = new QueryClient();
        const queryKey = ["memos", "notebook", "nb-inbox", "", "all", sort] as const;
        let source = Array.from({ length: 100 }, (_, index) => memo({
          id: `memo_${String(index).padStart(3, "0")}`,
          title: mutation === "rename" ? `标题 ${String(index).padStart(3, "0")}` : "Same",
          ...(mutation === "older-timestamp" ? { updatedAt: "2030-01-01T00:00:00.000Z" } : {}),
        }));
        const first = desktopOrder(source, sort).slice(0, 50);
        const data = queryData([first], 100);
        data.pages[0]!.nextCursor = "50";
        queryClient.setQueryData(queryKey, data);
        const selected = first[10]!;
        const changed = mutation === "rename"
          ? { ...selected, title: sort === "title-asc" ? "龥 tail" : "A tail" }
          : mutation === "remap" ? { ...selected, id: "memo_000-a" }
          : { ...selected, updatedAt: "2026-11-02T00:00:00.000Z", revision: 2 };
        source = source.map(item => item.id === selected.id ? changed : item);
        if (mutation === "remap") remapMemoIdsInLists(queryClient, new Map([[selected.id, changed.id]]));
        else updateMemoSummaryInLists(queryClient, changed);

        expect(queryClient.getQueryData<MemoListQueryData>(queryKey)!.pages.at(-1)!.nextCursor).toBe("49");
        if (mutation === "rename") {
          const changedAgain = { ...changed, title: `${changed.title}x`, revision: 3 };
          updateMemoSummaryInLists(queryClient, changedAgain);
          source = source.map(item => item.id === changed.id ? changedAgain : item);
          expect(queryClient.getQueryData<MemoListQueryData>(queryKey)!.pages.at(-1)!.nextCursor).toBe("49");
        }
        const expected = desktopOrder(source, sort);
        let loadedPages = 0;
        let returnedRows = 0;
        for (let page = 0; page < 3; page++) {
          const current = queryClient.getQueryData<MemoListQueryData>(queryKey)!;
          const cursor = current.pages.at(-1)!.nextCursor;
          if (cursor === null) break;
          const offset = Number(cursor);
          const next = expected.slice(offset, offset + 50);
          loadedPages++; returnedRows += next.length;
          queryClient.setQueryData(queryKey, {
            pages: [...current.pages, { memos: next, totalCount: 100, nextCursor: offset + next.length < expected.length ? String(offset + next.length) : null }],
            pageParams: [...current.pageParams, cursor],
          });
        }
        const completed = queryClient.getQueryData<MemoListQueryData>(queryKey)!;
        const unique = [...new Map(completed.pages.flatMap(page => page.memos).map(item => [item.id, item])).values()];
        expect(sortDesktopTitleMemoSummaries(unique, sort).map(item => item.id)).toEqual(expected.map(item => item.id));
        expect(completed.pages.at(-1)!.nextCursor).toBeNull();
        expect(loadedPages).toBe(2);
        expect(returnedRows).toBe(51);
        expect(completed.pages[0]!.totalCount).toBe(100);
        queryClient.clear();
      });
    }
  }

  test("renames across loaded pages and remaps IDs without reading or refetching the library", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", "nb-inbox", "", "all", "title-asc"] as const;
    const notes = Array.from({ length: 120 }, (_, index) => memo({ id: `memo-${index}`, title: `中文笔记 ${String(index).padStart(3, "0")}` }));
    const ordered = desktopOrder(notes, "title-asc");
    const data = queryData([ordered.slice(0, 50), ordered.slice(50, 100)], 120);
    data.pages[0]!.nextCursor = "50";
    data.pages[1]!.nextCursor = "100";
    data.pageParams = [null, "50"];
    let reads = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey, initialData: data, staleTime: Infinity,
      queryFn: async () => { reads++; return data; },
    });
    const unsubscribe = observer.subscribe(() => {});

    const updated = { ...notes[90]!, title: "A renamed note", revision: 2 };
    updateMemoSummaryInLists(queryClient, updated);
    let cached = queryClient.getQueryData<MemoListQueryData>(queryKey)!;
    expect(cached.pages.flatMap((page) => page.memos.map((item) => item.id)))
      .toEqual(desktopOrder(notes.map((item) => item.id === updated.id ? updated : item), "title-asc").slice(0, 100).map((item) => item.id));

    remapMemoIdsInLists(queryClient, new Map([[updated.id, "memo-remote-90"]]));
    cached = queryClient.getQueryData<MemoListQueryData>(queryKey)!;
    expect(cached.pages[0]!.memos[0]!.id).toBe("memo-remote-90");
    expect(cached.pages.map((page) => page.memos.length)).toEqual([50, 50]);
    expect(cached.pages.map((page) => page.totalCount)).toEqual([120, 120]);
    expect(cached.pages.map((page) => page.nextCursor)).toEqual(["50", "100"]);
    expect(cached.pageParams).toEqual([null, "50"]);
    await Promise.resolve();
    expect(reads).toBe(0);
    unsubscribe();
    queryClient.clear();
  });
});
