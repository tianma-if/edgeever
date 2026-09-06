export default {
  activate(context) {
    const disposeHello = context.commands.register({
      id: "hello",
      title: "Hello",
      run() {
        context.ui.showNotice("hello from plugin");
      },
    });
    const disposeRead = context.commands.register({
      id: "read-without-permission",
      title: "Read without permission",
      async run() {
        await context.notes.query();
      },
    });
    const disposeUpdate = context.commands.register({
      id: "update-without-read-permission",
      title: "Update without read permission",
      async run() {
        await context.notes.update("note-1", { title: "Changed" });
      },
    });
    const disposeEvent = context.commands.register({
      id: "subscribe-without-read-permission",
      title: "Subscribe without read permission",
      run() {
        context.events.on("note.updated", () => undefined);
      },
    });
    const disposeEditor = context.commands.register({
      id: "replace-selection",
      title: "Replace selection",
      async run() {
        const selection = await context.editor.getSelection();
        await context.editor.replaceSelection(selection.text.toUpperCase());
      },
    });
    const disposeSecret = context.commands.register({
      id: "write-secret",
      title: "Write secret",
      async run() {
        await context.secrets.set("token", "secret-value");
      },
    });
    const disposeStorage = context.commands.register({
      id: "write-storage",
      title: "Write storage",
      async run() {
        await context.storage.set("preference", "stored-value");
      },
    });
    const disposePanel = context.ui.panels.register({
      id: "fixture",
      title: "Fixture panel",
      mount(container) {
        container.mountedByFixture = true;
        return () => { container.mountedByFixture = false; };
      },
    });
    return () => {
      disposeHello();
      disposeRead();
      disposeUpdate();
      disposeEvent();
      disposeEditor();
      disposeSecret();
      disposeStorage();
      disposePanel();
    };
  },
};
