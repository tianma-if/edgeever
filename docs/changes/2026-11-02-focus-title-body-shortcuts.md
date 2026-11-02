# Keyboard shortcuts to focus the note title and body

[简体中文](2026-11-02-focus-title-body-shortcuts.zh-CN.md)

Related Issue: #759

## Problem and outcome

After switching notes or searching, moving the caret to the title or the body of the current note needs the mouse. Add two configurable shortcut actions, **Focus note title** and **Focus note body**, to the existing shortcut system so they appear in Settings → Shortcuts and can be re-recorded like the other actions.

## Behavior

1. Defaults: `⌘⌥T` (macOS), `Ctrl+Alt+T` (Windows) and `Ctrl+Alt+Shift+T` (Linux and ChromeOS, where `Ctrl+Alt+T` opens a terminal) for the title; `⌘⌥B` / `Ctrl+Alt+B` for the body. The platform default comes from `getDefaultShortcutSettings`, which also backs **Restore defaults**. They do not overlap the existing EdgeEver defaults or the Tiptap/CodeMirror keymaps (`Mod-Shift-B` blockquote, `Mod-Alt-1…6` headings, `Mod-Alt-C` code block).
2. Both actions work from anywhere in the workspace while a text note is open, including the search field and the note list. The title action places the caret at the end of the title. The body action focuses the rich-text editor (Tiptap restores the previous caret) or the Markdown source editor, depending on the current mode; the mobile plain-text editor is handled the same way.
3. Nothing happens for read-only notes (trash, reading protection), while a dialog that blocks editor shortcuts is open, or when no note is selected. Table, diagram, poster and infographic notes ignore the actions.
4. The standalone desktop note window handles the same actions.
5. On Apple keyboards Option changes the reported key (`⌘⌥T` reports `†`), so matching falls back to the physical letter from `event.code` when Option is held, as the shortcut recorder already does. Other platforms keep matching the produced character, so layouts that type a character with AltGr (`Ctrl+Alt`) keep typing it.

## Boundaries, risks and recovery

The change is client-only: shortcut settings stay in the existing `edgeever.shortcutSettings` local preference, and older stored settings receive the new defaults through the existing fill-in path. There is no server, database, migration, sync, installer or update change.

Risks: a browser or OS may still claim one of the combinations; users can rebind them in Settings. A user who already recorded one of these combinations for another action keeps that action, because earlier actions match first. Roll back by reverting the change; older versions ignore the extra stored keys.

## Verification

- Unit tests cover defaults, Windows/Linux/macOS matching (including the macOS Option character), AltGr characters not matching, fill-in for older settings and the Settings list order.
- Playwright (`tests/e2e/note-focus-shortcuts.spec.ts`, run in the existing browser CI job) for Windows, macOS and Linux platform defaults: the focused element and the title caret at the end, from the search field and from inside the Markdown editor, the rich-text and Markdown bodies, no focus change under reading protection or while the quick switcher dialog is open, and the note title and body left unchanged. Removing the read-only guard makes the spec fail.
- Browser check on a local self-hosted build (Chrome, macOS): title from the search field, body in rich-text and Markdown modes, title from inside the Markdown editor, no action under reading protection, and both actions listed in Settings → Shortcuts.
- `bun run typecheck`, `bun run typecheck:mobile`, `bun run lint`, `bun run build:web` and `bun run test` passed.
- Windows/Linux real keyboards and the packaged desktop note window were not verified manually.
