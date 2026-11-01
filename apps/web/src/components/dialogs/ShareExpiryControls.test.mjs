import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { enUS } from "../../../../../packages/shared/src/i18n/en-US.ts";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { ShareExpiryControls } from "./ShareExpiryControls.tsx";

const render = async (props) => {
  const i18n = createInstance();
  await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(TooltipProvider, null,
    createElement(ShareExpiryControls, { expiresAt: null, expired: false, busy: false, invalid: false, onChange() {}, ...props }))));
};

describe("share expiry controls", () => {
  test("a share without expiry shows the picker and no expiry status", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Link expiry"');
    expect(html).not.toContain("Expires ");
    expect(html).not.toContain("This link has expired");
  });

  test("an active expiry shows its date", async () => {
    const html = await render({ expiresAt: "2999-01-01T12:00:00.000Z" });
    expect(html).toContain("Expires ");
    expect(html).not.toContain("This link has expired");
  });

  test("an expired share explains the visitor state and keeps the choices", async () => {
    const html = await render({ expiresAt: "2020-01-01T12:00:00.000Z", expired: true });
    expect(html).toContain("Expired ");
    expect(html).toContain("This link has expired. Visitors see an expiry message");
  });

  test("a rejected date is reported", async () => {
    expect(await render({ invalid: true })).toContain("Choose a date in the future.");
  });
});

describe("share dialog expiry and views", () => {
  const dialog = readFileSync(new URL("./ShareMemoDialog.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../settings/ShareManagementCard.tsx", import.meta.url), "utf8");

  test("the dialog reads expiry from the server and sends only the expiry", () => {
    expect(dialog).toContain("expired={share.expired === true}");
    expect(dialog).toContain("api.updateMemoShare(memoId, { expiresAt })");
    expect(dialog).toContain('expiryMutation.error.code === "share_expiry_invalid"');
  });

  test("the dialog and the share list show how often a link was opened", () => {
    for (const source of [dialog, settings]) {
      expect(source).toContain('t("sharing.viewsCount", { count: share.viewCount })');
      expect(source).toContain('t("sharing.viewsNone")');
    }
    expect(settings).toContain('t("sharing.expiredBadge")');
  });
});
