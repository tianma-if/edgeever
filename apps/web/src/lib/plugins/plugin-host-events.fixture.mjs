export default {
  activate(context) {
    const disposeNote = context.events.on("note.updated", ({ note }) => {
      globalThis.edgeeverPluginObservedNote = note;
    });
    const disposeTemplate = context.events.on("template.created", ({ template }) => {
      globalThis.edgeeverPluginObservedTemplate = template;
    });
    const disposeResource = context.events.on("resource.updated", ({ resource }) => {
      globalThis.edgeeverPluginObservedResource = resource;
    });
    return () => {
      disposeNote();
      disposeTemplate();
      disposeResource();
    };
  },
};
