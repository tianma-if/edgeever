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

test("account sign-out stays available while the remote device list loads or fails", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
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
});
