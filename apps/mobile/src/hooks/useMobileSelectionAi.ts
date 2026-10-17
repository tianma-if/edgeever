import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { ApiRequestError } from "@edgeever/client";
import { useQuery } from "@tanstack/react-query";
import type { LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { buildMobileAiStreamBridgePayload, parseMobileSelectionAiRequest } from "../lib/mobile-ai-selection";
import { safeDomCall } from "../lib/safe-dom-call";
import type { useSession } from "../lib/session";
import { getMobileCatalog } from "../lib/mobile-locale";

type MobileAiClient = NonNullable<ReturnType<typeof useSession>["client"]>;

export const useMobileSelectionAi = ({
  client,
  editorRef,
  resolvedLocale,
  titleRef,
}: {
  client: MobileAiClient | null | undefined;
  editorRef: RefObject<LocalTiptapEditorRef | null>;
  resolvedLocale: "zh-CN" | "en-US" | "ja" | "pl";
  titleRef: RefObject<string>;
}) => {
  const activeRequestRef = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const promptsQuery = useQuery({
    queryKey: ["ai-prompts", resolvedLocale],
    queryFn: async () => (await client!.listAiPrompts(resolvedLocale)).prompts,
    enabled: Boolean(client),
    retry: false,
  });
  const aiPromptsJson = useMemo(
    () => JSON.stringify(promptsQuery.data ?? []),
    [promptsQuery.data],
  );

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);

  const requestSelectionAi = useCallback(async (requestJson: string) => {
    if (!client) throw new Error(getMobileCatalog(resolvedLocale).mobile.ai.signedOut);
    const request = parseMobileSelectionAiRequest(requestJson);
    if (!request) throw new Error(getMobileCatalog(resolvedLocale).mobile.ai.invalidRequest);

    activeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    activeRequestRef.current = { requestId: request.requestId, controller };

    void client.streamAiGeneration({
      action: request.action,
      promptId: request.promptId,
      locale: request.locale ?? resolvedLocale,
      title: titleRef.current.trim(),
      contentMarkdown: request.contentMarkdown,
      targetLanguage: request.targetLanguage,
      tone: request.tone,
      instruction: request.instruction,
    }, {
      signal: controller.signal,
      onEvent: (event) => {
        safeDomCall(() => editorRef.current?.pushAiStreamEvent(
          buildMobileAiStreamBridgePayload(request.requestId, event)
        ));
      },
    }).catch((requestError) => {
      if (controller.signal.aborted) return;
      const message = requestError instanceof ApiRequestError && requestError.code === "ai_not_configured"
        ? getMobileCatalog(resolvedLocale).mobile.ai.modelNotConfigured
        : requestError instanceof Error
          ? requestError.message
          : getMobileCatalog(resolvedLocale).mobile.ai.generationFailed;
      safeDomCall(() => editorRef.current?.pushAiStreamEvent(buildMobileAiStreamBridgePayload(request.requestId, {
        type: "error",
        code: "ai_generation_failed",
        message,
      })));
    }).finally(() => {
      if (activeRequestRef.current?.requestId === request.requestId) {
        activeRequestRef.current = null;
      }
    });
  }, [client, editorRef, resolvedLocale, titleRef]);

  const cancelSelectionAi = useCallback(async (requestId: string) => {
    if (activeRequestRef.current?.requestId !== requestId) return;
    activeRequestRef.current.controller.abort();
    activeRequestRef.current = null;
  }, []);

  return { aiPromptsJson, cancelSelectionAi, requestSelectionAi };
};
