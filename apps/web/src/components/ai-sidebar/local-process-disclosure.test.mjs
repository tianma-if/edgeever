import { describe, expect, test } from "bun:test";
import {
  initialLocalProcessDisclosure,
  LOCAL_PROCESS_CLOSE_DELAY_MS,
  syncLocalProcessDisclosure,
  toggleLocalProcessDisclosure,
} from "./local-process-disclosure.ts";

const thinking = { running: true, answering: false };
const answering = { running: true, answering: true };
const finished = { running: false, answering: true };

describe("local process disclosure", () => {
  test("starts open only while thinking", () => {
    expect(initialLocalProcessDisclosure(thinking).open).toBe(true);
    expect(initialLocalProcessDisclosure(answering).open).toBe(false);
    expect(initialLocalProcessDisclosure(finished).open).toBe(false);
    expect(LOCAL_PROCESS_CLOSE_DELAY_MS).toBe(1000);
  });

  test("stays open through thinking and schedules a close once the answer starts", () => {
    const open = initialLocalProcessDisclosure(thinking);
    expect(syncLocalProcessDisclosure(open, thinking)).toEqual(open);
    expect(syncLocalProcessDisclosure(open, answering)).toEqual({ closeSoon: true });
    expect(syncLocalProcessDisclosure(open, finished)).toEqual({ closeSoon: true });
  });

  test("does not reopen a panel the user collapsed while thinking", () => {
    const collapsed = toggleLocalProcessDisclosure(initialLocalProcessDisclosure(thinking), false, thinking);
    expect(collapsed).toEqual({ open: false, dismissed: true, heldOpen: false });
    expect(syncLocalProcessDisclosure(collapsed, thinking)).toEqual(collapsed);
    expect(syncLocalProcessDisclosure(collapsed, answering)).toEqual(collapsed);
  });

  test("keeps a manual reopen after the answer starts", () => {
    const closed = { open: false, dismissed: false, heldOpen: false };
    const reopened = toggleLocalProcessDisclosure(closed, true, answering);
    expect(reopened.heldOpen).toBe(true);
    expect(syncLocalProcessDisclosure(reopened, answering)).toEqual(reopened);
    expect(syncLocalProcessDisclosure(reopened, finished)).toEqual(reopened);
  });

  test("still closes when the user reopens during thinking and the answer then starts", () => {
    const collapsed = toggleLocalProcessDisclosure(initialLocalProcessDisclosure(thinking), false, thinking);
    const reopened = toggleLocalProcessDisclosure(collapsed, true, thinking);
    expect(reopened).toEqual({ open: true, dismissed: false, heldOpen: false });
    expect(syncLocalProcessDisclosure(reopened, answering)).toEqual({ closeSoon: true });
  });
});
