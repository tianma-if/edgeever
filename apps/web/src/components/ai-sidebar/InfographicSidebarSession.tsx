import { useTranslation } from "react-i18next";
import { ArrowUp, PanelRightClose, Sparkles, Undo2 } from "lucide-react";
import type { MouseEvent } from "react";
import type { InfographicConversationTurn } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { SidebarAgentModeStatus } from "./SidebarAgentModeStatus";
import { memoIdFromSidebarLinkEvent, rewriteSidebarNoteLinks, sidebarNoteLinkAllowedTags, sidebarNoteLinkComponents } from "./sidebar-note-links";

const threadClassName = cn(
  "gap-3 p-3 text-[13px] leading-[1.6]",
  "[&_[data-streamdown=heading-1]]:mt-3 [&_[data-streamdown=heading-1]]:mb-1 [&_[data-streamdown=heading-1]]:text-[15px] [&_[data-streamdown=heading-1]]:leading-snug",
  "[&_[data-streamdown=heading-2]]:mt-3 [&_[data-streamdown=heading-2]]:mb-1 [&_[data-streamdown=heading-2]]:text-[15px] [&_[data-streamdown=heading-2]]:leading-snug",
  "[&_[data-streamdown=heading-3]]:mt-2.5 [&_[data-streamdown=heading-3]]:mb-1 [&_[data-streamdown=heading-3]]:text-sm [&_[data-streamdown=heading-3]]:leading-snug",
  "[&_[data-streamdown=inline-code]]:text-[12px]",
);
const userMessageClassName = "whitespace-pre-wrap break-words text-[13px] leading-5 group-[.is-user]:rounded-xl group-[.is-user]:bg-slate-100 group-[.is-user]:px-3 group-[.is-user]:py-2";

export type InfographicSidebarTurn = {
  prompt: string;
  response: string;
  template?: string;
  decision?: string;
  question?: string;
};

export type InfographicSidebarController = {
  turns: InfographicConversationTurn[];
  activeTurn: InfographicSidebarTurn | null;
  generating: boolean;
  readOnly: boolean;
  canUndo: boolean;
  hasGraphic: boolean;
  onSubmit: (prompt: string) => Promise<void>;
  onUndo: () => void;
  onStop: () => void;
};

function InfographicSidebarComposer({ session }: { session: InfographicSidebarController }) {
  const { t } = useTranslation();
  const { textInput } = usePromptInputController();
  const draft = textInput.value.trim();
  return (
    <PromptInput
      inputGroupClassName="rounded-[22px] border-slate-200 bg-card shadow-sm has-[[data-slot=input-group-control]:focus-visible]:ring-0"
      onSubmit={async ({ text }) => {
        const raw = text.trim().slice(0, 1000);
        if (!raw || session.generating) throw new Error("empty");
        await session.onSubmit(raw);
      }}
    >
      <PromptInputTextarea
        className="min-h-20 px-4 pb-2 pt-4 text-[13px] leading-5 md:text-[13px]"
        disabled={session.generating}
        maxLength={1000}
        placeholder={t(session.hasGraphic ? "infographic.refinePrompt" : "infographic.prompt")}
      />
      <PromptInputFooter className="px-2.5 pb-2.5 pt-0">
        <PromptInputTools>
          {session.canUndo ? (
            <Button type="button" size="sm" variant="outline" disabled={session.generating} onClick={session.onUndo}>
              <Undo2 className="mr-1 h-3.5 w-3.5" />
              {t("infographic.undoGeneration")}
            </Button>
          ) : null}
        </PromptInputTools>
        {session.generating ? (
          <Button type="button" size="sm" variant="outline" onClick={session.onStop}>
            {t("aiAssistant.sidebar.stop")}
          </Button>
        ) : (
          <PromptInputSubmit
            aria-label={t(session.hasGraphic ? "infographic.applyRefinement" : "infographic.generate")}
            className="rounded-full border-slate-900 bg-slate-900 text-slate-50 hover:border-slate-800 hover:bg-slate-800 disabled:border-slate-100 disabled:bg-slate-100 disabled:text-slate-300"
            disabled={!draft}
            variant="solid"
          >
            <ArrowUp className="size-4" />
          </PromptInputSubmit>
        )}
      </PromptInputFooter>
    </PromptInput>
  );
}

function InfographicReply({ children, isAnimating }: { children: string; isAnimating?: boolean }) {
  return (
    <MessageResponse
      allowedTags={sidebarNoteLinkAllowedTags}
      className="edgeever-infographic-chat-response break-words"
      components={sidebarNoteLinkComponents}
      isAnimating={isAnimating}
    >
      {rewriteSidebarNoteLinks(children)}
    </MessageResponse>
  );
}

export function InfographicSidebarSession({
  session,
  noteTitle,
  onOpenChange,
  onOpenNote,
}: {
  session: InfographicSidebarController;
  noteTitle?: string;
  onOpenChange: (open: boolean) => void;
  onOpenNote?: (memoId: string, notebookId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const title = noteTitle?.trim() || t("infographic.name");
  const openLinkedNote = (event: MouseEvent<HTMLElement>) => {
    const linkedId = memoIdFromSidebarLinkEvent(event);
    if (!linkedId || !onOpenNote) return;
    onOpenNote(linkedId, "");
  };
  const reply = (turn: InfographicConversationTurn) => turn.response
    || (turn.kind === "clarified"
      ? t("infographic.historyClarified")
      : turn.kind === "failed"
        ? t("infographic.historyFailed")
        : t(turn.kind === "generated" ? "infographic.historyGenerated" : "infographic.historyRefined", { title: turn.resultTitle || t("infographic.name") }));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card" data-infographic-ai-sidebar="">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-[13px] text-slate-800">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </span>
        <SidebarAgentModeStatus />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t("aiAssistant.sidebar.close")}
          aria-label={t("aiAssistant.sidebar.close")}
          onClick={() => onOpenChange(false)}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>
      <Conversation className="min-h-0 flex-1" aria-label={t("infographic.historyTitle")}>
        <ConversationContent className={threadClassName} onClick={openLinkedNote}>
          {!session.turns.length && !session.activeTurn ? (
            <ConversationEmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title={t(session.hasGraphic ? "infographic.refine" : "infographic.describe")}
              description={t(session.hasGraphic ? "infographic.refinePrompt" : "infographic.prompt")}
            />
          ) : null}
          {session.turns.map((turn) => (
            <div key={turn.id} data-infographic-turn={turn.id} className="space-y-2">
              <Message from="user">
                <MessageContent className={userMessageClassName}>{turn.prompt}</MessageContent>
              </Message>
              <Message from="assistant">
                <MessageContent className="w-full text-foreground">
                  <InfographicReply>{reply(turn)}</InfographicReply>
                  {turn.decision && turn.decision !== turn.response ? <p className="text-xs text-slate-600">{turn.decision}</p> : null}
                  {turn.template ? <p className="text-xs text-slate-500">{turn.template}</p> : null}
                  {turn.error ? <p className="text-xs text-red-600">{turn.error}</p> : null}
                  {turn.undoneAt ? <p className="text-xs text-slate-500">{t("infographic.historyUndone")}</p> : null}
                  <time className="block text-xs text-slate-500" dateTime={turn.createdAt}>{new Date(turn.createdAt).toLocaleString(i18n.resolvedLanguage)}</time>
                </MessageContent>
              </Message>
            </div>
          ))}
          {session.activeTurn ? (
            <div className="space-y-2" aria-live="polite">
              <Message from="user">
                <MessageContent className={userMessageClassName}>{session.activeTurn.prompt}</MessageContent>
              </Message>
              <Message from="assistant">
                <MessageContent className="w-full text-foreground">
                  <InfographicReply isAnimating={session.generating}>
                    {session.activeTurn.response || session.activeTurn.question || t("infographic.generating")}
                  </InfographicReply>
                  {session.activeTurn.decision && session.activeTurn.decision !== session.activeTurn.response ? <p className="text-xs text-slate-600">{session.activeTurn.decision}</p> : null}
                  {session.activeTurn.template ? <p className="text-xs text-slate-500">{session.activeTurn.template}</p> : null}
                </MessageContent>
              </Message>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton aria-label={t("infographic.scrollToBottom")} />
      </Conversation>
      {!session.readOnly ? (
        <div className="shrink-0 p-3">
          <PromptInputProvider>
            <InfographicSidebarComposer session={session} />
          </PromptInputProvider>
        </div>
      ) : null}
    </div>
  );
}
