import { useCallback, useEffect, useRef, type RefObject } from "react";
import { ApiRequestError } from "@edgeever/client";
import type { LocalTiptapEditorRef } from "../components/LocalTiptapEditor";
import { buildMobileAiStreamBridgePayload, parseMobileSelectionAiRequest } from "../lib/mobile-ai-selection";
import { safeDomCall } from "../lib/safe-dom-call";
import type { useSession } from "../lib/session";

type MobileAiClient = NonNullable<ReturnType<typeof useSession>["client"]>;

export const useMobileSelectionAi = ({
  client,
  editorRef,
  resolvedLocale,
  titleRef,
}: {
  client: MobileAiClient | null | undefined;
  editorRef: RefObject<LocalTiptapEditorRef | null>;
  resolvedLocale: "zh-CN" | "en-US";
  titleRef: RefObject<string>;
}) => {
  const activeRequestRef = useRef<{ requestId: string; controller: AbortController } | null>(null);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);

  const requestSelectionAi = useCallback(async (requestJson: string) => {
    if (!client) throw new Error(resolvedLocale === "en-US" ? "AI is unavailable while signed out." : "当前未登录，无法使用 AI。");
    const request = parseMobileSelectionAiRequest(requestJson);
    if (!request) throw new Error(resolvedLocale === "en-US" ? "The AI request is invalid." : "AI 请求无效。");

    activeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    activeRequestRef.current = { requestId: request.requestId, controller };

    void client.streamAiGeneration({
      action: request.action,
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
        ? (resolvedLocale === "en-US"
            ? "Configure a model in AI Integrations on the web or desktop app first."
            : "请先在 Web 或桌面端的“AI 集成”中配置模型。")
        : requestError instanceof Error
          ? requestError.message
          : resolvedLocale === "en-US" ? "AI generation failed." : "AI 生成失败。";
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

  return { cancelSelectionAi, requestSelectionAi };
};
