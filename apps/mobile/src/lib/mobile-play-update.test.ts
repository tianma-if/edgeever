import { describe, expect, test } from "bun:test";
import { MobilePlayUpdate } from "./mobile-play-update";
import type { GooglePlayUpdateResult, GooglePlayUpdateState } from "../../modules/edgeever-app-store";

const available: GooglePlayUpdateState = { status: "available", versionCode: 234 };
const unavailable: GooglePlayUpdateState = { status: "unavailable", versionCode: 0 };

function setup(result: GooglePlayUpdateResult = "accepted") {
  let snapshot = available;
  let starts = 0;
  const states: GooglePlayUpdateState[] = [];
  const controller = new MobilePlayUpdate({
    check: async () => snapshot,
    start: async () => { starts += 1; return result; },
  }, (state) => states.push(state));
  return { controller, states, offer: () => controller.start(), starts: () => starts, snapshot: (state: GooglePlayUpdateState) => { snapshot = state; } };
}

describe("Google Play flexible updates", () => {
  test("automatically requests consent and downloads without restarting", async () => {
    const { controller, states, starts, offer } = setup();
    expect(await controller.check(offer)).toBe(true);
    expect(starts()).toBe(1);
    expect(states.map((state) => state.status)).toEqual(["available", "downloading"]);
    controller.receive({ ...available, status: "ready" });
    expect(controller.state.status).toBe("ready");
  });

  test("declining prevents repeat automatic prompts but allows manual retry", async () => {
    const { controller, starts, snapshot, offer } = setup("cancelled");
    await controller.check(offer);
    await controller.check(offer);
    expect(starts()).toBe(1);
    expect(controller.state.status).toBe("available");
    await controller.start();
    expect(starts()).toBe(2);
    snapshot({ ...available, versionCode: 235 });
    await controller.check(offer);
    expect(starts()).toBe(3);
  });

  test("unavailable Play updates allow existing release and OTA checks to continue", async () => {
    const { controller, starts, snapshot, offer } = setup();
    snapshot(unavailable);
    expect(await controller.check(offer)).toBe(false);
    expect(controller.hasKnownUpdate).toBe(false);
    expect(starts()).toBe(0);
  });

  test("a launch failure falls back and is not automatically prompted again", async () => {
    const { controller, starts, offer } = setup("unavailable");
    expect(await controller.check(offer)).toBe(false);
    expect(controller.hasKnownUpdate).toBe(true);
    await controller.check(offer);
    expect(starts()).toBe(1);
    expect(await controller.start()).toBe("unavailable");
  });

  test.each(["downloading", "ready"] as const)("recovers %s on foreground without launching another consent flow", async (status) => {
    const { controller, starts, snapshot } = setup();
    snapshot({ ...available, status });
    expect(await controller.check()).toBe(true);
    expect(controller.state.status).toBe(status);
    expect(starts()).toBe(0);
  });

  test("manual checks discover Play updates without automatically opening consent", async () => {
    const { controller, starts } = setup();
    expect(await controller.check()).toBe(true);
    expect(starts()).toBe(0);
  });

  test("concurrent taps share one consent request and never regress a downloaded event", async () => {
    let resolve!: (result: GooglePlayUpdateResult) => void;
    let starts = 0;
    const controller = new MobilePlayUpdate({
      check: async () => available,
      start: () => { starts += 1; return new Promise((done) => { resolve = done; }); },
    }, () => {});
    await controller.check();
    const first = controller.start();
    const second = controller.start();
    controller.receive({ ...available, status: "ready" });
    resolve("accepted");
    await Promise.all([first, second]);
    expect(starts).toBe(1);
    expect(controller.state.status).toBe("ready");
  });

  test("a stale check cannot overwrite a newer download event", async () => {
    let resolve!: (state: GooglePlayUpdateState) => void;
    const controller = new MobilePlayUpdate({
      check: () => new Promise((done) => { resolve = done; }),
      start: async () => "accepted",
    }, () => {});
    const pending = controller.check();
    controller.receive({ ...available, status: "ready" });
    resolve(unavailable);
    expect(await pending).toBe(true);
    expect(controller.state.status).toBe("ready");
  });

  test("download failure leaves the Play state so manual update sources can take over", async () => {
    const { controller, offer } = setup();
    await controller.check(offer);
    controller.receive({ ...available, status: "unavailable" });
    expect(controller.state.status).toBe("unavailable");
  });

  test.each(["automatic", "manual"] as const)("%s release notes can defer native consent until the user confirms", async (trigger) => {
    const { controller, starts } = setup();
    let offered: number | null = null;
    const showNotes = async (versionCode: number) => { offered = versionCode; };
    if (trigger === "automatic") {
      await controller.check(showNotes);
    } else {
      await controller.check();
      await controller.offer(showNotes);
    }
    expect(offered).toBe(available.versionCode);
    await controller.check(async () => { throw new Error("Already offered"); });
    expect(starts()).toBe(0);
    await controller.start();
    expect(starts()).toBe(1);
  });
});
