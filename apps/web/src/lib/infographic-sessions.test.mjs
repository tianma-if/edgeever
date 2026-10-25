import { describe, expect, test } from "bun:test";
import {
  INFOGRAPHIC_LEGACY_SESSION_ID,
  infographicSessionHistory,
  infographicSessionStamp,
  infographicSessionThreads,
  resolveInfographicSessionId,
} from "./infographic-sessions.ts";

const turn = (id, createdAt, prompt, extra = {}) => ({
  id,
  prompt,
  createdAt,
  kind: "refined",
  resultTitle: "",
  ...extra,
});

describe("infographic sidebar sessions", () => {
  test("keeps older turns in one session and starts a new one without that context", () => {
    const history = [
      turn("one", "2026-10-01T00:00:00.000Z", "做成里程碑"),
      turn("two", "2026-10-02T00:00:00.000Z", "把第二项改成用户增长", { undoneAt: "2026-10-02T01:00:00.000Z" }),
      turn("three", "2026-10-24T00:00:00.000Z", "改成技术演进", { sessionId: "session-new", kind: "failed" }),
    ];
    expect(resolveInfographicSessionId(history, null)).toBe("session-new");
    expect(resolveInfographicSessionId(history.slice(0, 2), null)).toBe(INFOGRAPHIC_LEGACY_SESSION_ID);
    expect(infographicSessionThreads(history).map((thread) => thread.title)).toEqual(["改成技术演进", "做成里程碑"]);
    expect(infographicSessionHistory(history, INFOGRAPHIC_LEGACY_SESSION_ID).map((item) => item.id)).toEqual(["one"]);
    expect(infographicSessionHistory(history, "session-new")).toEqual([]);
    expect(infographicSessionStamp(INFOGRAPHIC_LEGACY_SESSION_ID)).toEqual({});
    expect(infographicSessionStamp("session-new")).toEqual({ sessionId: "session-new" });
    expect(resolveInfographicSessionId([], "session-empty")).toBe("session-empty");
    expect(infographicSessionThreads([])).toEqual([]);
  });
});
