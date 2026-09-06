export default {
  activate(context) {
    const disposeCount = context.commands.register({
      id: "count-recent-notes",
      title: "Count recent notes",
      async run() {
        const result = await context.notes.query({ sort: "updated-desc", limit: 10 });
        context.ui.showNotice(`EdgeEver returned ${result.notes.length} recent notes.`);
      },
    });
    const disposeUppercase = context.commands.register({
      id: "uppercase-selection",
      title: "Uppercase selection",
      async run() {
        const selection = await context.editor.getSelection();
        if (!selection || selection.empty) {
          context.ui.showNotice("Select some text in the active note first.");
          return;
        }
        await context.editor.replaceSelection(selection.text.toUpperCase());
      },
    });
    const disposePanel = context.ui.panels.register({
      id: "recent-notes",
      title: "Recent notes",
      mount(container) {
        const heading = document.createElement("h2");
        heading.textContent = "Recent notes inspector";
        heading.style.fontWeight = "700";
        const output = document.createElement("p");
        output.textContent = "Loading…";
        output.style.marginTop = "12px";
        container.append(heading, output);
        void context.notes.query({ sort: "updated-desc", limit: 5 }).then((result) => {
          output.textContent = result.notes.length
            ? result.notes.map((note) => note.title || note.excerpt || "Untitled").join(" · ")
            : "No notes found.";
        });
      },
    });
    return () => {
      disposeCount();
      disposeUppercase();
      disposePanel();
    };
  },
};
