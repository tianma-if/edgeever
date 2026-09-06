import { z } from 'zod';

export const PluginAiGenerateSchema = z.object({
  system: z.string().max(8000),
  prompt: z.string().min(1).max(90000),
  maxOutputTokens: z.number().int().min(1).max(5000).optional(),
}).strict();
export type PluginAiGenerateRequest = z.infer<typeof PluginAiGenerateSchema>;
export interface PluginAiStatus { configured: boolean; modelName?: string }

export const PluginPublicFetchSchema = z.object({
  url: z.string().min(1).max(8192),
  method: z.enum(['GET', 'HEAD']).default('GET'),
  headers: z.record(z.string().max(100), z.string().max(2000)).default({}),
}).strict();
export type PluginPublicFetchRequest = z.infer<typeof PluginPublicFetchSchema>;
export interface PluginPublicFetchResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}
