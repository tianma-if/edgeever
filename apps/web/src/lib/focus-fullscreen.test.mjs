import { expect, test, mock } from "bun:test";
import { createFocusFullscreen } from "./focus-fullscreen";

const setup = () => {
  const events = new EventTarget();
  const doc = Object.assign(events, {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: {},
    exitFullscreen: mock(async () => {
      doc.fullscreenElement = null;
      events.dispatchEvent(new Event("fullscreenchange"));
    }),
  });
  doc.documentElement.requestFullscreen = mock(async () => {
    doc.fullscreenElement = doc.documentElement;
    events.dispatchEvent(new Event("fullscreenchange"));
  });
  const onExit = mock();
  return { doc, onExit, control: createFocusFullscreen(doc, onExit) };
};

test("requests fullscreen during the gesture and exits with the focus control", async () => {
  const { doc, control, onExit } = setup();
  control.setEnabled(true);
  expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  control.setEnabled(false);
  expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  expect(onExit).not.toHaveBeenCalled();
  control.dispose();
});

test("browser Escape exits focus mode and repeated sessions remain usable", async () => {
  const { doc, control, onExit } = setup();
  control.setEnabled(true);
  await Promise.resolve();
  await doc.exitFullscreen();
  expect(onExit).toHaveBeenCalledTimes(1);
  control.setEnabled(true);
  await Promise.resolve();
  control.dispose();
  expect(doc.fullscreenElement).toBeNull();
});

test("unsupported, rejected and synchronously failed requests retain focus fallback", async () => {
  for (const failure of ["unsupported", "rejected", "thrown"]) {
    const { doc, control, onExit } = setup();
    if (failure === "unsupported") doc.fullscreenEnabled = false;
    else doc.documentElement.requestFullscreen = mock(() => {
      if (failure === "thrown") throw new Error("Denied");
      return Promise.reject(new Error("Denied"));
    });
    control.setEnabled(true);
    await Promise.resolve();
    control.setEnabled(false);
    expect(onExit).not.toHaveBeenCalled();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    control.dispose();
  }
});

test("leaves fullscreen opened by other controls alone", () => {
  const { doc, control } = setup();
  doc.fullscreenElement = doc.documentElement;
  control.setEnabled(true);
  control.setEnabled(false);
  control.dispose();
  expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  expect(doc.exitFullscreen).not.toHaveBeenCalled();
});

test("exits a pending request after focus mode closes or unmounts", async () => {
  for (const dispose of [false, true]) {
    const { doc, control, onExit } = setup();
    let resolve;
    doc.documentElement.requestFullscreen = () => new Promise((done) => { resolve = done; });
    control.setEnabled(true);
    if (dispose) control.dispose();
    else control.setEnabled(false);
    doc.fullscreenElement = doc.documentElement;
    resolve();
    await Promise.resolve();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    control.dispose();
  }
});
