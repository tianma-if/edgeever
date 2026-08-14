import { expect, test } from "bun:test";
import { createMobileDraftWriteBarrier } from "./mobile-draft-write-barrier";

test("drains an active draft write before submit cleanup continues", async () => {
  const events: string[] = [];
  let finishWrite: (() => void) | null = null;
  const barrier = createMobileDraftWriteBarrier();

  const write = barrier.enqueue(async () => {
    events.push("write:start");
    await new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    events.push("write:end");
  });
  await Promise.resolve();

  const drained = barrier.blockAndDrain().then(() => {
    events.push("drained");
  });
  expect(events).toEqual(["write:start"]);

  finishWrite?.();
  await Promise.all([write, drained]);
  expect(events).toEqual(["write:start", "write:end", "drained"]);
});

test("drops queued and future draft writes after submit begins", async () => {
  const events: string[] = [];
  let finishFirstWrite: (() => void) | null = null;
  const barrier = createMobileDraftWriteBarrier();

  const first = barrier.enqueue(async () => {
    events.push("first");
    await new Promise<void>((resolve) => {
      finishFirstWrite = resolve;
    });
  });
  await Promise.resolve();
  const stale = barrier.enqueue(async () => {
    events.push("stale");
  });
  const drained = barrier.blockAndDrain();
  const late = barrier.enqueue(async () => {
    events.push("late");
  });

  finishFirstWrite?.();
  expect(await first).toBe(true);
  expect(await stale).toBe(false);
  await drained;
  expect(await late).toBe(false);
  expect(events).toEqual(["first"]);
});

test("accepts draft writes again when a submit fails", async () => {
  const barrier = createMobileDraftWriteBarrier();
  await barrier.blockAndDrain();
  barrier.unblock();

  let writes = 0;
  expect(await barrier.enqueue(async () => {
    writes += 1;
  })).toBe(true);
  expect(writes).toBe(1);
});
