import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { createExcerpt, docToMarkdown, docToText, emptyDoc, type MemoDetail, type MemoEditSession, type Notebook, type TiptapDoc } from "@edgeever/shared";
import { getMobileEditorInputAttributes, getMobileEditorPlaceholder, type MobileEditorTableActionId } from "@edgeever/shared/mobile-editor";
import {
  MobileEditorFallback,
  MobileEditorHeader,
  MobileEditorNotebookButton,
  MobileEditorNotebookSheet,
  MobileEditorToolbar,
} from "@/components/MobileStandaloneEditorParts";
import { getEditableMemoTitle, getNotebookMoveOptions } from "@/lib/app-helpers";
import { defaultLocale, normalizeLocale } from "@/i18n/locales";
import { compressImageForUpload } from "@/lib/image-compression";
import { localDb, type LocalDraft } from "@/lib/local-db";
import {
  getStandaloneMobileEditorReturnPath,
  markStandaloneMobileEditorReturning,
  writeMobileEditorReturnPreview,
} from "@/lib/mobile-editor";
import {
  MOBILE_EDITOR_AUTO_SAVE_DELAY_MS,
  MOBILE_EDITOR_INITIAL_FOCUS_DELAY_MS,
  MOBILE_EDITOR_LEAVE_SAVE_TIMEOUT_MS,
  getMobileEditorDraftKey,
  getMobileEditorParams,
  getMobileEditorStatusClassName,
  normalizeMobileEditorDoc,
  parseMobileEditorTags,
  requestMobileEditorJson,
  uploadMobileEditorResource,
  type MobileEditorDraft,
  type MobileEditorMemoResponse,
  type MobileEditorSaveState,
} from "@/lib/mobile-editor-standalone";
import { getMemoUpdateQueueId, isMemoUpdateAlreadyApplied, queueMemoUpdate, shouldQueueMemoSaveError } from "@/lib/sync-queue";
import { EdgeEverCodeBlock, codeBlockLowlight } from "@/lib/code-block";
import { ThemeBlock } from "./ThemeBlock";

type ListNotebooksResponse = {
  notebooks: Notebook[];
};

type MobileStandaloneTiptapEditorProps = {
  memoId?: string | null;
  onLeave?: () => void;
};

export const MobileStandaloneTiptapEditor = ({
  memoId: memoIdProp,
  onLeave,
}: MobileStandaloneTiptapEditorProps = {}) => {
  const params = useMemo(() => getMobileEditorParams(), []);
  const { t, i18n } = useTranslation();
  const memoId = memoIdProp ?? params.get("memoId");
  const locale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language) ?? defaultLocale;
  const draftKey = getMobileEditorDraftKey(memoId);
  const [memo, setMemo] = useState<MemoDetail | null>(null);
  const memoRef = useRef<MemoDetail | null>(null);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookUpdatePending, setNotebookUpdatePending] = useState(false);
  const [notebookSheetOpen, setNotebookSheetOpen] = useState(false);
  const [title, setTitle] = useState("");
  const titleRef = useRef("");
  const [tagsText, setTagsText] = useState("");
  const tagsTextRef = useRef("");
  const contentJsonRef = useRef<TiptapDoc>(emptyDoc());
  const [saveState, setSaveState] = useState<MobileEditorSaveState>("loading");
  const saveStateRef = useRef<MobileEditorSaveState>("loading");
  const [error, setError] = useState<string | null>(null);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const [, setToolbarVersion] = useState(0);
  const dirtyRef = useRef(false);
  const leavingRef = useRef(false);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const initialFocusTimerRef = useRef<number | null>(null);
  const currentSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const lastSavedSnapshotRef = useRef("");
  const backgroundSavePendingRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const setSaveStateStable = useCallback((nextState: MobileEditorSaveState) => {
    if (saveStateRef.current === nextState) {
      return;
    }

    saveStateRef.current = nextState;
    setSaveState(nextState);
  }, []);

  const currentSnapshot = useCallback(
    () =>
      JSON.stringify({
        title: titleRef.current,
        tagsText: tagsTextRef.current,
        contentJson: contentJsonRef.current,
      }),
    []
  );

  const persistLocalDraft = useCallback(() => {
    if (!draftKey) {
      return;
    }

    const currentMemo = memoRef.current;
    const draft: MobileEditorDraft = {
      expectedRevision: currentMemo?.revision,
      title: titleRef.current,
      tagsText: tagsTextRef.current,
      contentJson: contentJsonRef.current,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));

    if (!currentMemo || currentMemo.isDeleted) {
      return;
    }

    void localDb.drafts.put({
      memoId: currentMemo.id,
      expectedRevision: currentMemo.revision,
      title: draft.title,
      tagsText: draft.tagsText,
      contentJson: draft.contentJson,
      updatedAt: draft.updatedAt,
    });
  }, [draftKey]);

  const readLocalDraft = useCallback((): MobileEditorDraft | null => {
    if (!draftKey) {
      return null;
    }

    try {
      const raw = localStorage.getItem(draftKey);
      return raw ? (JSON.parse(raw) as MobileEditorDraft) : null;
    } catch {
      return null;
    }
  }, [draftKey]);

  const readBestLocalDraft = useCallback(async (): Promise<MobileEditorDraft | null> => {
    const browserDraft = readLocalDraft();
    const persistedDraft = memoId ? await localDb.drafts.get(memoId).catch(() => null) : null;
    const drafts = [browserDraft, persistedDraft].filter(Boolean) as Array<MobileEditorDraft | LocalDraft>;

    if (drafts.length === 0) {
      return null;
    }

    const latest = drafts.reduce((current, candidate) =>
      Date.parse(candidate.updatedAt || "") > Date.parse(current.updatedAt || "") ? candidate : current
    );

    return {
      expectedRevision: latest.expectedRevision,
      title: latest.title,
      tagsText: latest.tagsText,
      contentJson: latest.contentJson,
      updatedAt: latest.updatedAt,
    };
  }, [memoId, readLocalDraft]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight, defaultLanguage: "plaintext" }),
      ThemeBlock,
      Image.configure({
        allowBase64: false,
        inline: false,
      }),
      TableKit.configure({
        table: { renderWrapper: true },
      }),
      Placeholder.configure({
        placeholder: getMobileEditorPlaceholder(locale),
      }),
    ],
    content: emptyDoc(),
    editorProps: {
      attributes: getMobileEditorInputAttributes("edgeever-mobile-tiptap-content"),
    },
    onUpdate: ({ editor: activeEditor }) => {
      contentJsonRef.current = activeEditor.getJSON() as TiptapDoc;
      dirtyRef.current = true;
      persistLocalDraft();

      if (saveStateRef.current !== "dirty") {
        setSaveStateStable("dirty");
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void saveNowRef.current();
      }, MOBILE_EDITOR_AUTO_SAVE_DELAY_MS);
    },
  });

  const saveNowRef = useRef<({ keepalive }?: { keepalive?: boolean }) => Promise<boolean>>(async () => false);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const refreshToolbar = () => setToolbarVersion((version) => version + 1);

    editor.on("selectionUpdate", refreshToolbar);
    editor.on("transaction", refreshToolbar);
    editor.on("focus", refreshToolbar);
    editor.on("blur", refreshToolbar);

    return () => {
      editor.off("selectionUpdate", refreshToolbar);
      editor.off("transaction", refreshToolbar);
      editor.off("focus", refreshToolbar);
      editor.off("blur", refreshToolbar);
    };
  }, [editor]);

  useEffect(() => {
    memoRef.current = memo;
  }, [memo]);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    tagsTextRef.current = tagsText;
  }, [tagsText]);

  const clearPersistedDrafts = useCallback(async (memoId: string) => {
    if (draftKey) {
      localStorage.removeItem(draftKey);
    }

    await Promise.all([
      localDb.drafts.delete(memoId),
      localDb.syncQueue.delete(getMemoUpdateQueueId(memoId)),
    ]);
  }, [draftKey]);

  const buildSavePayload = useCallback((currentMemo: MemoDetail) => {
    const editSession = editSessionRef.current;
    if (!editSession || editSession.memoId !== currentMemo.id) {
      throw new Error(t("editor.saveState.error"));
    }

    return {
      expectedRevision: currentMemo.revision,
      expectedContentHash: currentMemo.contentHash,
      editSessionId: editSession.id,
      title: titleRef.current,
      contentJson: contentJsonRef.current,
      tags: parseMobileEditorTags(tagsTextRef.current),
    };
  }, []);

  const applySavedMemo = useCallback(async (savedMemo: MemoDetail, savedSnapshot: string) => {
    memoRef.current = savedMemo;
    if (editSessionRef.current) {
      editSessionRef.current = {
        ...editSessionRef.current,
        baseRevision: savedMemo.revision,
        baseContentHash: savedMemo.contentHash,
      };
    }
    setMemo(savedMemo);
    backgroundSavePendingRef.current = false;
    lastSavedSnapshotRef.current = savedSnapshot;

    if (currentSnapshot() === savedSnapshot) {
      dirtyRef.current = false;
      await clearPersistedDrafts(savedMemo.id);
      setSaveStateStable("saved");
      window.setTimeout(() => {
        if (!dirtyRef.current && !savingRef.current && !leavingRef.current) {
          setSaveStateStable("idle");
        }
      }, 1200);
      return;
    }

    dirtyRef.current = true;
    persistLocalDraft();
    setSaveStateStable("dirty");
  }, [clearPersistedDrafts, currentSnapshot, persistLocalDraft, setSaveStateStable]);

  const sendBackgroundSave = useCallback(() => {
    const currentMemo = memoRef.current;
    if (!currentMemo || currentMemo.isDeleted || !dirtyRef.current) {
      return false;
    }

    const path = `/api/v1/memos/${encodeURIComponent(currentMemo.id)}/save`;
    const payload = buildSavePayload(currentMemo);
    const body = JSON.stringify(payload);
    const snapshot = currentSnapshot();

    // A direct save supersedes an older retry for this memo. The local draft remains
    // durable until the server response is confirmed, so removing the retry cannot
    // lose the user's latest text even if the page is suspended immediately after.
    void localDb.syncQueue.delete(getMemoUpdateQueueId(currentMemo.id));

    if (typeof navigator.sendBeacon === "function") {
      const accepted = navigator.sendBeacon(path, new Blob([body], { type: "application/json" }));

      if (accepted) {
        backgroundSavePendingRef.current = true;
        return true;
      }
    }

    void requestMobileEditorJson<MobileEditorMemoResponse>(path, {
      method: "POST",
      keepalive: true,
      body,
    })
      .then((data) => applySavedMemo(data.memo, snapshot))
      .catch((saveError) => {
        persistLocalDraft();
        if (shouldQueueMemoSaveError(saveError)) {
          void queueMemoUpdate({ memoId: currentMemo.id, ...payload });
        }
        setSaveStateStable("local-draft");
      });

    return true;
  }, [applySavedMemo, buildSavePayload, currentSnapshot, persistLocalDraft, setSaveStateStable]);

  const reconcileBackgroundSave = useCallback(async () => {
    const currentMemo = memoRef.current;
    if (!currentMemo || !backgroundSavePendingRef.current) {
      return;
    }

    try {
      const data = await requestMobileEditorJson<MobileEditorMemoResponse>(`/api/v1/memos/${encodeURIComponent(currentMemo.id)}`);
      const remoteSnapshot = JSON.stringify({
        title: data.memo.title || "",
        tagsText: Array.isArray(data.memo.tags) ? data.memo.tags.join(", ") : "",
        contentJson: normalizeMobileEditorDoc(data.memo),
      });

      memoRef.current = data.memo;
      setMemo(data.memo);
      backgroundSavePendingRef.current = false;

      if (remoteSnapshot === currentSnapshot()) {
        lastSavedSnapshotRef.current = remoteSnapshot;
        dirtyRef.current = false;
        await clearPersistedDrafts(data.memo.id);
        setSaveStateStable("saved");
        return;
      }

      dirtyRef.current = true;
      persistLocalDraft();
      void saveNowRef.current();
    } catch {
      persistLocalDraft();
      setSaveStateStable("local-draft");
    }
  }, [clearPersistedDrafts, currentSnapshot, persistLocalDraft, setSaveStateStable]);

  const saveNow = useCallback(
    async ({ keepalive = false }: { keepalive?: boolean } = {}) => {
      const currentMemo = memoRef.current;
      if (!currentMemo) {
        return false;
      }

      if (savingRef.current) {
        return currentSavePromiseRef.current ?? false;
      }

      const snapshot = currentSnapshot();
      if (!dirtyRef.current && snapshot === lastSavedSnapshotRef.current) {
        return true;
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      savingRef.current = true;
      setSaveStateStable("saving");
      setError(null);

      let payload: ReturnType<typeof buildSavePayload> | null = null;

      try {
        payload = buildSavePayload(currentMemo);
        await localDb.syncQueue.delete(getMemoUpdateQueueId(currentMemo.id)).catch(() => undefined);
        currentSavePromiseRef.current = (async () => {
          const data = await requestMobileEditorJson<MobileEditorMemoResponse>(`/api/v1/memos/${encodeURIComponent(currentMemo.id)}`, {
            method: "PATCH",
            keepalive,
            body: JSON.stringify(payload),
          });

          await applySavedMemo(data.memo, snapshot);
          return true;
        })();

        return await currentSavePromiseRef.current;
      } catch (saveError) {
        persistLocalDraft();
        if (payload && shouldQueueMemoSaveError(saveError)) {
          await queueMemoUpdate({ memoId: currentMemo.id, ...payload });
          setError(null);
          setSaveStateStable("local-draft");
          return true;
        }

        setError(saveError instanceof Error ? saveError.message : t("editor.saveState.error"));
        setSaveStateStable("error");
        return false;
      } finally {
        savingRef.current = false;
        currentSavePromiseRef.current = null;
      }
    },
    [applySavedMemo, buildSavePayload, currentSnapshot, persistLocalDraft, setSaveStateStable]
  );

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  const scheduleMetadataSave = useCallback(() => {
    dirtyRef.current = true;
    persistLocalDraft();
    setSaveStateStable("dirty");

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNow();
    }, MOBILE_EDITOR_AUTO_SAVE_DELAY_MS);
  }, [persistLocalDraft, saveNow, setSaveStateStable]);

  const persistReturnPreview = useCallback(() => {
    const currentMemo = memoRef.current;
    if (!currentMemo) {
      return;
    }

    writeMobileEditorReturnPreview({
      memoId: currentMemo.id,
      baseRevision: currentMemo.revision,
      title: titleRef.current || null,
      excerpt: createExcerpt(docToText(contentJsonRef.current)),
      tags: parseMobileEditorTags(tagsTextRef.current),
      updatedAt: dirtyRef.current ? new Date().toISOString() : currentMemo.updatedAt,
    });
  }, []);

  const navigateBack = useCallback(() => {
    persistReturnPreview();
    markStandaloneMobileEditorReturning(memoId);

    if (onLeave) {
      onLeave();
      return;
    }

    window.location.replace(memoId ? getStandaloneMobileEditorReturnPath(memoId) : "/");
  }, [memoId, onLeave, persistReturnPreview]);

  const leavePage = useCallback(async () => {
    if (leavingRef.current) {
      return;
    }

    leavingRef.current = true;
    persistLocalDraft();
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveStateStable("leaving");

    try {
      await Promise.race([
        saveNow({ keepalive: true }),
        new Promise((resolve) => window.setTimeout(resolve, MOBILE_EDITOR_LEAVE_SAVE_TIMEOUT_MS)),
      ]);
    } finally {
      navigateBack();
    }
  }, [navigateBack, persistLocalDraft, saveNow, setSaveStateStable]);

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    titleRef.current = nextTitle;
    scheduleMetadataSave();
  };

  const handleTagsChange = (nextTagsText: string) => {
    setTagsText(nextTagsText);
    tagsTextRef.current = nextTagsText;
    scheduleMetadataSave();
  };

  const handleNotebookChange = async (nextNotebookId: string) => {
    const currentMemo = memoRef.current;
    if (!currentMemo || !nextNotebookId || nextNotebookId === currentMemo.notebookId || notebookUpdatePending) {
      return;
    }

    setNotebookUpdatePending(true);
    setSaveStateStable("saving");
    setError(null);

    try {
      if (dirtyRef.current) {
        const saved = await saveNow();
        if (!saved) {
          return;
        }
      }

      const sourceMemo = memoRef.current;
      if (!sourceMemo || nextNotebookId === sourceMemo.notebookId) {
        return;
      }

      const data = await requestMobileEditorJson<MobileEditorMemoResponse>(`/api/v1/memos/${encodeURIComponent(sourceMemo.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: sourceMemo.revision,
          notebookId: nextNotebookId,
        }),
      });

      memoRef.current = data.memo;
      setMemo(data.memo);
      setSaveStateStable("saved");
      window.setTimeout(() => {
        if (!dirtyRef.current && !savingRef.current && !leavingRef.current) {
          setSaveStateStable("idle");
        }
      }, 1200);
    } catch (notebookError) {
      setError(notebookError instanceof Error ? notebookError.message : t("editor.saveState.error"));
      setSaveStateStable("error");
    } finally {
      setNotebookUpdatePending(false);
      setNotebookSheetOpen(false);
    }
  };

  const handleResourceUpload = async (file?: File | null) => {
    const currentMemo = memoRef.current;
    if (!currentMemo || !editor || !file) {
      return;
    }

    setError(null);
    try {
      const isImage = file.type.startsWith("image/");
      setSaveStateStable(isImage ? "compressing" : "uploading");
      const uploadFile = isImage ? (await compressImageForUpload(file)).file : file;
      setSaveStateStable("uploading");
      const { resource } = await uploadMobileEditorResource(currentMemo.id, uploadFile);
      if (resource.kind === "image") {
        editor
          .chain()
          .focus()
          .setImage({
            src: resource.url,
            alt: file.name,
            title: file.name,
          })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "paragraph",
            content: [{
              type: "text",
              text: `附件：${resource.filename || file.name}`,
              marks: [{
                type: "link",
                attrs: { href: resource.url, target: "_blank", class: "edgeever-attachment-link" },
              }],
            }],
          })
          .run();
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("editor.uploadState.fileFailed"));
      setSaveStateStable("error");
    }
  };

  const focusEditorAfterLoad = useCallback(() => {
    if (!editor) {
      return;
    }

    if (initialFocusTimerRef.current !== null) {
      window.clearTimeout(initialFocusTimerRef.current);
    }

    initialFocusTimerRef.current = window.setTimeout(() => {
      initialFocusTimerRef.current = null;

      if (leavingRef.current || editor.isDestroyed) {
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && activeElement !== document.documentElement) {
        return;
      }

      editor.commands.focus("end");
    }, MOBILE_EDITOR_INITIAL_FOCUS_DELAY_MS);
  }, [editor]);

  useEffect(() => {
    let cancelled = false;

    void requestMobileEditorJson<ListNotebooksResponse>("/api/v1/notebooks")
      .then((data) => {
        if (!cancelled) {
          setNotebooks(data.notebooks);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotebooks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!memoId || !editor) {
      if (!memoId) {
        setError(t("editor.saveState.error"));
        setSaveStateStable("error");
      }
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [data, sessionData] = await Promise.all([
          requestMobileEditorJson<MobileEditorMemoResponse>(`/api/v1/memos/${encodeURIComponent(memoId)}`),
          requestMobileEditorJson<{ editSession: MemoEditSession }>(`/api/v1/memos/${encodeURIComponent(memoId)}/edit-sessions`, {
            method: "POST",
            body: JSON.stringify({}),
          }),
        ]);
        if (cancelled) {
          return;
        }

        editSessionRef.current = sessionData.editSession;

        const nextTitle = getEditableMemoTitle(data.memo.title);
        const nextTagsText = Array.isArray(data.memo.tags) ? data.memo.tags.join(", ") : "";
        const nextContentJson = normalizeMobileEditorDoc(data.memo);
        let draft = await readBestLocalDraft();
        let queuedUpdate = await localDb.syncQueue.get(getMemoUpdateQueueId(data.memo.id));
        if (queuedUpdate && isMemoUpdateAlreadyApplied(data.memo, queuedUpdate)) {
          await Promise.all([
            localDb.syncQueue.delete(queuedUpdate.id),
            localDb.drafts.delete(data.memo.id),
          ]);
          if (draftKey) {
            localStorage.removeItem(draftKey);
          }
          draft = null;
          queuedUpdate = undefined;
        }
        const useDraft = Boolean(draft && (queuedUpdate || Date.parse(draft.updatedAt || "") >= Date.parse(data.memo.updatedAt || "")));

        setMemo(data.memo);

        if (useDraft && draft) {
          setTitle(draft.title || "");
          titleRef.current = draft.title || "";
          setTagsText(draft.tagsText || "");
          tagsTextRef.current = draft.tagsText || "";
          contentJsonRef.current = draft.contentJson || emptyDoc();
          editor.commands.setContent(contentJsonRef.current, { emitUpdate: false });
          dirtyRef.current = true;
          setSaveStateStable("local-draft");
          scheduleMetadataSave();
          focusEditorAfterLoad();
        } else {
          setTitle(nextTitle);
          titleRef.current = nextTitle;
          setTagsText(nextTagsText);
          tagsTextRef.current = nextTagsText;
          contentJsonRef.current = nextContentJson;
          editor.commands.setContent(nextContentJson, { emitUpdate: false });
          lastSavedSnapshotRef.current = JSON.stringify({
            title: nextTitle,
            tagsText: nextTagsText,
            contentJson: nextContentJson,
          });
          dirtyRef.current = false;
          setSaveStateStable("idle");
          focusEditorAfterLoad();
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : t("editor.loading"));
        setSaveStateStable("error");
      }
    })();

    return () => {
      cancelled = true;
      if (initialFocusTimerRef.current !== null) {
        window.clearTimeout(initialFocusTimerRef.current);
        initialFocusTimerRef.current = null;
      }
    };
  }, [editor, focusEditorAfterLoad, memoId, readBestLocalDraft, scheduleMetadataSave, setSaveStateStable, t]);

  useEffect(() => {
    const handlePageHide = () => {
      if (dirtyRef.current) {
        persistLocalDraft();
        if (!sendBackgroundSave()) {
          void saveNow({ keepalive: true });
        }
      }
      persistReturnPreview();
      markStandaloneMobileEditorReturning(memoId);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) {
        persistLocalDraft();
        if (!sendBackgroundSave()) {
          void saveNow({ keepalive: true });
        }
        markStandaloneMobileEditorReturning(memoId);
        return;
      }

      if (document.visibilityState === "hidden") {
        markStandaloneMobileEditorReturning(memoId);
        return;
      }

      if (document.visibilityState === "visible") {
        void (async () => {
          await reconcileBackgroundSave();
          if (dirtyRef.current && !backgroundSavePendingRef.current) {
            await saveNowRef.current();
          }
        })();
      }
    };
    const handleOnline = () => {
      void (async () => {
        if (backgroundSavePendingRef.current) {
          await reconcileBackgroundSave();
        }
        if (dirtyRef.current && !backgroundSavePendingRef.current) {
          await saveNowRef.current();
        }
      })();
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (initialFocusTimerRef.current !== null) {
        window.clearTimeout(initialFocusTimerRef.current);
      }
    };
  }, [currentSnapshot, draftKey, memoId, persistLocalDraft, persistReturnPreview, reconcileBackgroundSave, saveNow, sendBackgroundSave, setSaveStateStable]);

  const saveLabel =
    saveState === "loading"
      ? t("editor.loading")
      : saveState === "saving"
        ? t("editor.saveState.saving")
        : saveState === "compressing"
          ? t("editor.uploadState.compressing")
          : saveState === "uploading"
            ? t("editor.uploadState.uploading")
            : saveState === "dirty"
              ? t("editor.saveState.unsaved")
              : saveState === "saved"
                ? t("editor.saveState.saved")
                : saveState === "local-draft"
                  ? t("editor.saveState.unsaved")
                  : saveState === "leaving"
                    ? t("editor.backToList")
                    : saveState === "error"
                      ? t("editor.saveState.error")
                      : t("editor.saveState.saved");
  const statusClassName = getMobileEditorStatusClassName(saveState);
  const editorActionDisabled =
    !memo || !editor || saveState === "loading" || saveState === "compressing" || saveState === "uploading" || saveState === "leaving";
  const currentNotebookLabel =
    notebookOptions.find((notebook) => notebook.id === memo?.notebookId)?.name ?? t("editor.notebookFallback");

  const fallbackMarkdown = memo ? docToMarkdown(contentJsonRef.current) : "";
  const tableActive = Boolean(editor?.isActive("table"));
  const tableHeaderActive = Boolean(editor?.isActive("tableHeader"));

  const runEditorCommand = (command: () => boolean) => {
    if (editorActionDisabled || !editor) {
      return;
    }

    command();
    editor.commands.focus();
  };

  const runTableAction = (action: MobileEditorTableActionId) => {
    runEditorCommand(() => {
      const chain = editor?.chain().focus();
      if (!chain) {
        return false;
      }

      switch (action) {
        case "insertTable":
          return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        case "addTableRow":
          return chain.addRowAfter().run();
        case "deleteTableRow":
          return editor?.isActive("tableHeader") ? false : chain.deleteRow().run();
        case "addTableColumn":
          return chain.addColumnAfter().run();
        case "deleteTableColumn":
          return chain.deleteColumn().run();
        case "toggleTableHeader":
          return chain.toggleHeaderRow().run();
        case "deleteTable":
          return chain.deleteTable().run();
      }
    });
  };

  return (
    <div className="mobile-editor-shell">
      <MobileEditorHeader saveLabel={saveLabel} statusClassName={statusClassName} saveState={saveState} onLeave={() => void leavePage()} />

      <main className="mobile-editor-main">
        {error && <div className="mobile-editor-error">{error}</div>}
        <input
          className="mobile-editor-title"
          value={title}
          autoComplete="on"
          autoCorrect="on"
          inputMode="text"
          placeholder={t("common.untitledMemo")}
          onChange={(event) => handleTitleChange(event.target.value)}
        />
        <div className="mobile-editor-meta-row">
          <MobileEditorNotebookButton
            label={currentNotebookLabel}
            disabled={!memo || notebookUpdatePending || saveState === "loading" || notebookOptions.length === 0}
            onOpen={() => setNotebookSheetOpen(true)}
          />
          <input
            className="mobile-editor-tags"
            value={tagsText}
            autoComplete="on"
            autoCorrect="on"
            inputMode="text"
            placeholder={t("editor.tagPlaceholder")}
            onChange={(event) => handleTagsChange(event.target.value)}
          />
        </div>

        <MobileEditorToolbar
          disabled={editorActionDisabled}
          boldActive={Boolean(editor?.isActive("bold"))}
          bulletListActive={Boolean(editor?.isActive("bulletList"))}
          increaseListIndentAvailable={Boolean(editor?.can().chain().focus().sinkListItem("listItem").run())}
          decreaseListIndentAvailable={Boolean(editor?.can().chain().focus().liftListItem("listItem").run())}
          blockquoteActive={Boolean(editor?.isActive("blockquote"))}
          mermaidActive={Boolean(editor?.isActive("codeBlock", { language: "mermaid" }))}
          tableActive={tableActive}
          tableHeaderActive={tableHeaderActive}
          locale={locale}
          onPickImage={() => imageInputRef.current?.click()}
          onInsertMermaid={() => runEditorCommand(() => {
            if (!editor) {
              return false;
            }
            if (editor.isActive("codeBlock")) {
              return editor.chain().focus().updateAttributes("codeBlock", { language: "mermaid" }).run();
            }
            return editor.chain().focus().insertContent({
              type: "codeBlock",
              attrs: { language: "mermaid" },
              content: [{ type: "text", text: "flowchart LR\n  A[Start] --> B[End]" }],
            }).run();
          })}
          onToggleBold={() => runEditorCommand(() => editor?.chain().focus().toggleBold().run() ?? false)}
          onToggleBulletList={() => runEditorCommand(() => editor?.chain().focus().toggleBulletList().run() ?? false)}
          onIncreaseListIndent={() => runEditorCommand(() => editor?.chain().focus().sinkListItem("listItem").run() ?? false)}
          onDecreaseListIndent={() => runEditorCommand(() => editor?.chain().focus().liftListItem("listItem").run() ?? false)}
          onToggleBlockquote={() => runEditorCommand(() => editor?.chain().focus().toggleBlockquote().run() ?? false)}
          onSetHorizontalRule={() => runEditorCommand(() => editor?.chain().focus().setHorizontalRule().run() ?? false)}
          onTableAction={runTableAction}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="*/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void handleResourceUpload(file);
          }}
        />

        {notebookSheetOpen && (
          <MobileEditorNotebookSheet
            options={notebookOptions}
            selectedNotebookId={memo?.notebookId}
            updating={notebookUpdatePending}
            onClose={() => setNotebookSheetOpen(false)}
            onSelect={(notebookId) => void handleNotebookChange(notebookId)}
          />
        )}

        <div className="edgeever-mobile-tiptap-editor">
          <EditorContent editor={editor} />
        </div>

        {saveState === "error" && fallbackMarkdown && <MobileEditorFallback markdown={fallbackMarkdown} />}
      </main>
    </div>
  );
};
