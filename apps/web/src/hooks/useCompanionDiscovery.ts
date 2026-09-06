import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const discoverySettingsKey = (scope: string) => ["companion-discovery-settings", scope];
export const discoveryFeedKey = (scope: string) => ["companion-discovery-feed", scope];
export function useCompanionDiscoverySettings(scope: string) {
  return useQuery({ queryKey: discoverySettingsKey(scope), queryFn: async () => (await api.getCompanionDiscoverySettings()).settings,
    staleTime: 60_000, retry: false });
}
