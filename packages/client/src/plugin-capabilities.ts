import type { PluginAiGenerateRequest, PluginAiStatus, PluginPublicFetchRequest, PluginPublicFetchResponse } from '@edgeever/shared';

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type PublicRequest = (input: PluginPublicFetchRequest, signal?: AbortSignal) => Promise<PluginPublicFetchResponse>;
export function createPluginCapabilities(request: Request, requestPublic: PublicRequest) {
  return {
    pluginAi: {
      status: () => request<PluginAiStatus>('/api/v1/plugins/ai/status'),
      generate: ({ signal, ...input }: PluginAiGenerateRequest & { signal?: AbortSignal }) => request<{ text: string }>('/api/v1/plugins/ai/generate', { method: 'POST', body: JSON.stringify(input), signal }),
    },
    pluginNetwork: {
      fetchPublic: (input: PluginPublicFetchRequest, options?: { signal?: AbortSignal }) => requestPublic(input, options?.signal),
    },
  };
}
