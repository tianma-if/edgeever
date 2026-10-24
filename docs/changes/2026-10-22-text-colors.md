# Text and highlight colors

The rich text editor has a **Text and highlight colors** menu beside strikethrough. Select text or place the caret where you want to type, then choose from nine named text colors or nine highlight colors. The two properties work independently. Choose **Default text color**, **No highlight**, or **Reset text and highlight colors** to remove them. Code and read-only content disable the menu.

Colors are stored in the existing rich text JSON and in Markdown as inline `<span style="color: #rrggbb; background-color: #rrggbb">…</span>` markup. The shared Markdown codec handles this syntax in browsers and Workers without a DOM. Palette colors adapt visually in dark mode. The shared native editor schema preserves the marks; native color-picker UI is outside this change.

Validation covers selection, typing at the caret, independent reset, undo/redo, saving and reloading, rich text/Markdown switching, keyboard focus, dark-mode display, and server-side Markdown round trips. Native device testing has not been performed.
