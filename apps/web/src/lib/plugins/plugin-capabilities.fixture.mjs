export const results = new Map();
export default {
  activate(context) {
    for (const [id, action] of Object.entries({
      ai: () => context.ai.generate({ system: 'Translate', prompt: 'hello', maxOutputTokens: 100 }),
      public: () => context.network.fetch('https://example.org/feed', { transport: 'public', redirect: 'manual' }).then(async r => ({ status: r.status, text: await r.text(), url: r.url })),
      unlisted: () => context.network.fetch('https://unlisted.org/feed', { transport: 'public' }),
      post: () => context.network.fetch('https://example.org/feed', { transport: 'public', method: 'POST', body: 'data' }),
    })) context.commands.register({ id, title: id, run: async () => { results.set(context.pluginId, await action()); } });
  },
};
