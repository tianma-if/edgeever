export type NativeDesktopWindow = Window & {
  __EDGEEVER_NATIVE_DESKTOP__?: boolean;
  process?: {
    versions?: {
      electron?: string;
    };
  };
};

export const isNativeDesktopRuntime = () => {
  if (typeof window === "undefined") return false;
  const nativeWindow = window as NativeDesktopWindow;
  const electronProcess = nativeWindow.process?.versions?.electron;
  const electronUserAgent = /Electron\//i.test(window.navigator.userAgent);
  return Boolean(
    nativeWindow.__EDGEEVER_NATIVE_DESKTOP__ ||
      electronProcess ||
      electronUserAgent
  );
};
