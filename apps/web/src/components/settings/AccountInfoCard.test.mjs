import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { enUS } from "@edgeever/shared/i18n/en-US";
import { AccountInfoCard } from "./AccountInfoCard";
import { LoginDevicesCard } from "./LoginDevicesCard";

test("web and desktop show the current instance with switching instructions", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
  const previousWindow = globalThis.window;
  try {
    for (const desktopClient of [false, true]) {
      globalThis.window = {
        location: { origin: "http://127.0.0.1:5173" },
        edgeeverDesktop: { isAvailable: desktopClient, apiBaseUrl: "https://desktop.example.com" },
        localStorage: { getItem: () => null },
      };
      const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
        createElement(AccountInfoCard, {
          user: { id: "user-1", username: "alice", displayName: null, role: "owner" },
          isLoggingOut: false,
          onLogout() {},
        }),
      ));
      const text = parseHTML(html).document.querySelector("div").textContent;
      expect(text).toContain(enUS.session.currentInstance);
      expect(text).toContain(desktopClient ? "https://desktop.example.com" : "http://127.0.0.1:5173");
      if (desktopClient) {
        expect(text).toContain(enUS.session.signOutDescription);
        expect(text).not.toContain(enUS.session.webSignOutDescription);
      } else {
        expect(text).toContain(enUS.session.webSignOutDescription);
        expect(text).not.toContain(enUS.session.signOutDescription);
      }
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("account sign-out stays available while the remote device list loads or fails", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
  const previousWindow = globalThis.window;
  try {
    globalThis.window = {
      location: { origin: "http://127.0.0.1:5173" },
      edgeeverDesktop: { isAvailable: false },
      localStorage: { getItem: () => null },
    };
    const user = { id: "user-1", username: "alice", displayName: null, role: "owner" };
    for (const state of ["loading", "error"]) {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
      if (state === "error") {
        await queryClient.fetchQuery({
          queryKey: ["auth", "sessions"],
          queryFn: () => { throw new TypeError("Old instance is offline"); },
        }).catch(() => {});
      }
      const render = (isLoggingOut) => renderToStaticMarkup(
        createElement(I18nextProvider, { i18n },
          createElement(QueryClientProvider, { client: queryClient },
            createElement(AccountInfoCard, { user, isLoggingOut, onLogout() {} }),
            createElement(LoginDevicesCard, { authRequired: true }),
          ),
        ),
      );
      const html = render(false);
      expect(html).toContain(state === "error" ? enUS.loginDevices.loadFailed : enUS.loginDevices.loading);
      const button = parseHTML(html).document.querySelector("button");
      expect(button.textContent).toBe(enUS.session.logout);
      expect(button.hasAttribute("disabled")).toBe(false);
      const pendingButton = parseHTML(render(true)).document.querySelector("button");
      expect(pendingButton.textContent).toBe(enUS.session.loggingOut);
      expect(pendingButton.hasAttribute("disabled")).toBe(true);
      queryClient.clear();
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
