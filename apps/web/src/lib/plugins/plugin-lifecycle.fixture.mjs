export default {
  async activate(context) {
    await context.notes.query();
    const panel = context.ui.panels.register({ id: 'delayed', title: 'Delayed', mount() {} });
    const command = context.commands.register({ id: 'open', title: 'Open', run() {} });
    return () => { command(); panel(); };
  },
};
