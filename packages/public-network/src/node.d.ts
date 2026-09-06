import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
type ResolveAll = (hostname: string, options: { all: true; verbatim: true }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
export function createPublicLookup(resolve?: ResolveAll): LookupFunction;
export const publicLookup: LookupFunction;
export function nodePublicFetch(input: string, init?: RequestInit): Promise<Response>;
