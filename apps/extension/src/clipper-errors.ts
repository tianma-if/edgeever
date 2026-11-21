import { t } from "./i18n";

type ClipperErrorCode = "completePluginConfiguration" | "instancePermissionRequired" | "noAvailableNotebooks";

export class ClipperError extends Error {
  constructor(readonly code: ClipperErrorCode) {
    super(code);
  }
}

export const clipperErrorMessage = (error: unknown) =>
  error instanceof ClipperError ? t(error.code) : null;

export const needsClipperSettings = (error: unknown) =>
  error instanceof ClipperError
  && (error.code === "completePluginConfiguration" || error.code === "instancePermissionRequired");
