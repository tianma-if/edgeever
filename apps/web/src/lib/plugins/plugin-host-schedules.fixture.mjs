export default {
  async activate(context) {
    context.commands.register({ id: "refresh", title: "Refresh", run() {} });
    await context.schedules.upsert({
      key: "hourly-refresh",
      name: "Hourly refresh",
      commandId: "refresh",
      cronExpression: "0 * * * *",
    });
  },
};
