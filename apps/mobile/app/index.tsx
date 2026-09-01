import * as SplashScreen from "expo-splash-screen";
import { useIncomingShare } from "expo-sharing";
import { useIsRestoring } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Text } from "../src/components/LocalizedText";
import { LoginScreen } from "../src/screens/LoginScreen";
import { clearAndRefreshIncomingShare } from "../src/lib/incoming-share-lifecycle";
import { useSession } from "../src/lib/session";
import { markStartup } from "../src/lib/startup-performance";
import { resolveMobileThemeStyles, useMobileTheme } from "../src/lib/mobile-theme";

const WorkspaceScreen = lazy(() =>
  import("../src/screens/WorkspaceScreen").then((module) => ({ default: module.WorkspaceScreen }))
);

export default function IndexScreen() {
  const { isLoading, session } = useSession();
  const isRestoringCache = useIsRestoring();
  const {
    clearSharedPayloads,
    error: incomingShareError,
    isResolving: isResolvingIncomingShare,
    resolvedSharedPayloads,
    refreshSharePayloads,
    sharedPayloads,
  } = useIncomingShare();
  const incomingSharePayloads = resolvedSharedPayloads.length > 0
    ? resolvedSharedPayloads
    : sharedPayloads;
  const isWaitingForBinaryShareResolution = !incomingShareError
    && resolvedSharedPayloads.length === 0
    && sharedPayloads.some((payload) => payload.shareType !== "text" && payload.shareType !== "url");
  const handleIncomingShareHandled = useCallback(() => {
    void clearAndRefreshIncomingShare(clearSharedPayloads, refreshSharePayloads);
  }, [clearSharedPayloads, refreshSharePayloads]);

  useEffect(() => {
    if (!isLoading && !isRestoringCache) {
      markStartup("index-ready");
      void SplashScreen.hideAsync();
    }
  }, [isLoading, isRestoringCache]);

  if (isLoading || isRestoringCache) {
    return <StartupPlaceholder />;
  }

  return session ? (
    <Suspense fallback={<StartupPlaceholder showBrand />}>
      <WorkspaceScreen
        incomingShareError={incomingShareError}
        incomingShareIsResolving={isResolvingIncomingShare || isWaitingForBinaryShareResolution}
        incomingSharePayloads={incomingSharePayloads}
        onIncomingShareHandled={handleIncomingShareHandled}
      />
    </Suspense>
  ) : (
    <LoginScreen />
  );
}

const StartupPlaceholder = ({ showBrand = false }: { showBrand?: boolean }) => {
  const { resolvedTheme } = useMobileTheme();
  const themedStyles = resolveMobileThemeStyles(styles, resolvedTheme);
  return (
    <View style={themedStyles.loading}>
      {showBrand ? <Text style={themedStyles.brand}>EdgeEver</Text> : null}
      <ActivityIndicator color="#15803d" />
    </View>
  );
};

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    backgroundColor: "#f7faf7",
    flex: 1,
    gap: 16,
    justifyContent: "center",
  },
  brand: {
    color: "#17211a",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
});
