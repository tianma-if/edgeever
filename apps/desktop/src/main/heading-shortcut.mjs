const DIGIT_CODE = /^(?:Digit|Numpad)([0-6])$/;

/**
 * Mod+0..6 heading chords. Keep the match identical to
 * headingShortcutLevelFromEvent in apps/web/src/lib/editor-shortcuts.ts.
 * Level 0 is body text. The rich-text editor claims it so the reset-zoom
 * menu role does not also fire.
 */
export const headingLevelFromShortcutInput = (input) => {
  if (!input || input.type !== "keyDown") return null;
  if (input.isComposing || input.alt || input.shift || input.isAutoRepeat) return null;
  if (!input.control && !input.meta) return null;

  const codeLevel = DIGIT_CODE.exec(input.code ?? "");
  if (codeLevel) return Number(codeLevel[1]);
  if (/^[0-6]$/.test(input.key ?? "")) return Number(input.key);
  return null;
};

export const shouldClaimParagraphShortcut = (input, richTextHeadingShortcutActive) =>
  richTextHeadingShortcutActive === true && headingLevelFromShortcutInput(input) === 0;

export const createHeadingShortcutGuard = () => {
  let richTextHeadingShortcutActive = false;

  const guard = {
    setActive(active) {
      richTextHeadingShortcutActive = active === true;
    },
    reset() {
      richTextHeadingShortcutActive = false;
    },
    isActive() {
      return richTextHeadingShortcutActive;
    },
    handleInput(input, preventDefault, send) {
      if (!shouldClaimParagraphShortcut(input, richTextHeadingShortcutActive)) return false;
      preventDefault();
      send(0);
      return true;
    },
    attach(webContents) {
      richTextHeadingShortcutActive = false;
      webContents.on("before-input-event", (event, input) => {
        guard.handleInput(
          input,
          () => event.preventDefault(),
          (level) => webContents.send("desktop:heading-shortcut", level),
        );
      });
      webContents.on("did-start-loading", () => {
        richTextHeadingShortcutActive = false;
      });
    },
  };

  return guard;
};
