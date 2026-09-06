export const PUBLIC_NETWORK_MAX_BYTES: number;
export const PUBLIC_NETWORK_TIMEOUT_MS: number;
export function isPublicAddress(address: string): boolean;
export function validatePublicUrl(input: string): URL;
export function publicRequestHeaders(input: Record<string, string>): Record<string, string>;
export function publicResponseHeaders(headers: Headers): Record<string, string>;
export function readPublicBody(response: Response, signal: AbortSignal): Promise<Uint8Array>;
