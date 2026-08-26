import "react-native-gesture-handler";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useState, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/lib/session";
import { MobileThemeProvider, useMobileTheme } from "../src/lib/mobile-theme";
import { MobileLocaleProvider } from "../src/lib/mobile-locale";
import { AppDialogProvider } from "../src/components/AppDialogProvider";
import { MobileUpdateProvider } from "../src/lib/mobile-update";

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

const MOBILE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MOBILE_CACHE_STALE_TIME = 5 * 60 * 1000;
const MAX_PERSISTED_MEMO_LISTS = 12;
const MAX_PERSISTED_MEMO_DETAILS = 20;

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: MOBILE_CACHE_MAX_AGE,
            networkMode: "offlineFirst",
            refetchOnReconnect: true,
            retry: 1,
            staleTime: MOBILE_CACHE_STALE_TIME,
          },
        },
      })
  );
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      key: "edgeever.mobile.query-cache.v1",
      storage: AsyncStorage,
      throttleTime: 1_000,
      serialize: (persistedClient) => {
        const queries = persistedClient.clientState.queries;
        const notebooks = queries.filter((query) => query.queryKey[1] === "notebooks");
        const memoLists = queries
          .filter((query) => query.queryKey[1] === "memos")
          .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
          .slice(0, MAX_PERSISTED_MEMO_LISTS);
        const memoDetails = queries
          .filter((query) => query.queryKey[1] === "memo")
          .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
          .slice(0, MAX_PERSISTED_MEMO_DETAILS);

        return JSON.stringify({
          ...persistedClient,
          clientState: {
            ...persistedClient.clientState,
            queries: [...notebooks, ...memoLists, ...memoDetails],
          },
        });
      },
    })
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileThemeProvider>
        <MobileLocaleProvider>
          <ThemedApp>
            <SafeAreaProvider>
              <AppDialogProvider>
                <MobileUpdateProvider>
                  <PersistQueryClientProvider
                    client={queryClient}
                    persistOptions={{
                      buster: "native-cache-v1",
                      dehydrateOptions: {
                        shouldDehydrateQuery: (query) => {
                          const section = query.queryKey[1];
                          const isOfflineReadableData = section === "notebooks" || section === "memos" || section === "memo";

                          return query.state.status === "success" && isOfflineReadableData;
                        },
                      },
                      maxAge: MOBILE_CACHE_MAX_AGE,
                      persister,
                    }}
                  >
                    <SessionProvider>
                      <Stack screenOptions={{ headerShown: false }} />
                    </SessionProvider>
                  </PersistQueryClientProvider>
                </MobileUpdateProvider>
              </AppDialogProvider>
            </SafeAreaProvider>
          </ThemedApp>
        </MobileLocaleProvider>
      </MobileThemeProvider>
    </GestureHandlerRootView>
  );
}

const ThemedApp = ({ children }: { children: ReactNode }) => {
  const { resolvedTheme } = useMobileTheme();
  return (
    <>
      {children}
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
    </>
  );
};
