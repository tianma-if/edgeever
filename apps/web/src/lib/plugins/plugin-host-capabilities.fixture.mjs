export default {
  activate(context) {
    const disposeExercise = context.commands.register({
      id: "exercise-capabilities",
      title: "Exercise capabilities",
      async run() {
        const notebook = await context.notebooks.create({ name: "Created by plugin" });
        const moved = await context.notes.move(["note-1"], notebook.id);
        const pinned = await context.notes.pin(["note-1"], true);
        const revisions = await context.notes.revisions.list("note-1");
        const resources = await context.resources.list("note-1");
        const resourceBlob = await context.resources.read("resource-1");
        const uploaded = await context.resources.upload("note-1", new File(["hello"], "hello.txt", { type: "text/plain" }));
        const updatedResource = await context.resources.update("resource-1", {
          file: new File(["updated"], "drawing.excalidraw", { type: "application/vnd.excalidraw+json" }),
          expectedContentHash: resources[0].contentHash,
        });
        const endpoint = await context.settings.get("endpoint");
        const note = await context.notes.get("note-1");
        const edited = await context.notes.editMarkdown("note-1", {
          expectedRevision: note.revision,
          expectedContentHash: note.contentHash,
          edits: [{ from: 0, to: 5, insert: "Updated" }],
        });
        const contentQuery = await context.notes.queryContent({ limit: 10 });
        const templates = await context.templates.list();
        const createdTemplate = await context.templates.create({ name: "Plugin template", contentMarkdown: "Template" });
        const updatedTemplate = await context.templates.update(createdTemplate.id, { name: "Updated template" });
        const templatedNote = await context.templates.use(updatedTemplate.id, "notebook-1");
        await context.templates.delete(updatedTemplate.id);
        const editorDocument = await context.editor.getDocument();
        const editedEditorDocument = await context.editor.editMarkdown([{ from: 0, to: 5, insert: "Live" }]);
        const insertedEmbed = await context.editor.insertEmbed({
          type: "drawing",
          resourceId: updatedResource.id,
          title: "Architecture",
          data: { mode: "edit" },
        });
        await context.ui.openNote("note-1", { search: "Updated note" });
        await context.ui.panels.open("capability-panel", { state: { resourceId: updatedResource.id } });
        globalThis.edgeeverPluginCapabilityResult = {
          notebook, moved, pinned, revisions, resources, resourceText: await resourceBlob.text(), uploaded, updatedResource, endpoint, note, edited,
          contentQuery, templates, createdTemplate, updatedTemplate, templatedNote, editorDocument, editedEditorDocument,
          insertedEmbed,
        };
      },
    });
    const disposePanel = context.ui.panels.register({
      id: "capability-panel",
      title: "Capability panel",
      presentation: "fullscreen",
      mount(container, panelContext) {
        container.panelState = panelContext.state;
        container.requestPanelClose = panelContext.requestClose;
        return () => {
          delete container.panelState;
          delete container.requestPanelClose;
        };
      },
      beforeClose() {
        return { title: "Unsaved drawing", message: "Close without saving?", confirmLabel: "Close drawing" };
      },
    });
    const disposeEmbed = context.editor.embeds.register({
      type: "drawing",
      mount(container, embed) {
        container.dataset.embedId = embed.id;
        return () => delete container.dataset.embedId;
      },
    });
    const disposeStaleEdit = context.commands.register({
      id: "edit-stale-note",
      title: "Edit stale note",
      async run() {
        await context.notes.editMarkdown("note-1", {
          expectedRevision: 2,
          expectedContentHash: "stale-hash",
          edits: [{ from: 0, to: 0, insert: "stale" }],
        });
      },
    });
    return () => {
      disposeExercise();
      disposeStaleEdit();
      disposePanel();
      disposeEmbed();
    };
  },
};
