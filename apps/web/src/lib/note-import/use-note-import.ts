import { useEffect, useMemo, useRef } from "react";
import { getConfiguredDesktopApiBaseUrl } from "../api";
import { NoteImportController } from "./controller";

export const useNoteImport = (accountId: string | null, accountLabel: string, refresh: () => Promise<void>) => {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const labelRef = useRef(accountLabel);
  labelRef.current = accountLabel;
  const target = getConfiguredDesktopApiBaseUrl() || window.location.origin;
  const controller = useMemo(() => new NoteImportController(accountId, target, () => labelRef.current, () => refreshRef.current()), [accountId, target]);
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  return controller;
};
