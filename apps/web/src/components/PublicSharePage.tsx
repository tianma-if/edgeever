import "katex/dist/katex.min.css";
import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQuery } from "@tanstack/react-query";
import { Clock3, FileText, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { api } from "@/lib/api";
import { EdgeEverCodeBlock, codeBlockLowlight } from "@/lib/code-block";
import {
  parseImageWidth,
  getImageReferrerPolicy,
  MergeDivider,
  resolveMemoContentDoc,
  rewriteMemoResourcesForShare,
  type PublicMemoShare,
} from "@edgeever/shared";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";

const SharedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => parseImageWidth(element.getAttribute("data-width") ?? element.style.width),
        renderHTML: (attributes) => {
          const width = parseImageWidth(attributes.width);
          return width ? { "data-width": String(width), style: `width: ${width}%` } : {};
        },
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const referrerPolicy = getImageReferrerPolicy(HTMLAttributes.src);
    return [
      "img",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        referrerPolicy ? { referrerpolicy: referrerPolicy } : {},
      ),
    ];
  },
});

const SharedThemeBlock = Node.create({
  name: "edgeeverThemeBlock",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      kind: {
        default: "intro",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-theme-block-kind") || "intro",
        renderHTML: (attributes: { kind?: string }) => ({ "data-theme-block-kind": attributes.kind || "intro" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "section[data-theme-block-kind]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes, { "data-edgeever-theme-block": "true" }), 0];
  },
});

const SharedDocument = ({ share, token }: { share: PublicMemoShare; token: string }) => {
  const content = useMemo(
    () => rewriteMemoResourcesForShare(resolveMemoContentDoc(share.contentJson, share.contentMarkdown), token),
    [share, token],
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight, defaultLanguage: "plaintext" }),
      MergeDivider,
      ...createEdgeEverMathematics(),
      SharedThemeBlock,
      SharedImage.configure({ allowBase64: false, inline: false }),
      TableKit.configure({ table: { renderWrapper: true } }),
    ],
    content,
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-slate max-w-none focus:outline-none",
        "aria-label": "Shared note content",
      },
    },
  }, [content]);

  return <EditorContent editor={editor} />;
};

export const PublicSharePage = () => {
  const { t, i18n } = useTranslation();
  const { token = "" } = useParams();
  const shareQuery = useQuery({
    queryKey: ["public-share", token],
    queryFn: () => api.getPublicMemoShare(token),
    enabled: Boolean(token),
    retry: false,
  });
  const share = shareQuery.data?.share;

  useEffect(() => {
    const previousTitle = document.title;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow,noarchive";
    document.head.appendChild(robots);
    if (share) document.title = `${share.title?.trim() || t("common.untitledMemo")} · EdgeEver`;
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, [share, t]);

  if (shareQuery.isLoading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 text-slate-500">
        <LoaderCircle className="h-6 w-6 animate-spin" aria-label={t("sharing.publicLoading")} />
      </main>
    );
  }

  if (!share) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-5">
        <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto h-9 w-9 text-slate-400" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">{t("sharing.publicUnavailable")}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{t("sharing.publicUnavailableHint")}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="edgeever-public-share min-h-[100dvh] bg-slate-50 px-4 py-6 sm:px-8 sm:py-10">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-5 py-6 sm:px-10 sm:py-8">
          <div className="mb-5 flex items-center justify-between gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <ShieldCheck className="h-4 w-4" /> EdgeEver · {t("sharing.readOnly")}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="h-4 w-4" />
              {t("sharing.publicUpdated", {
                time: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(share.updatedAt)),
              })}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            {share.title?.trim() || t("common.untitledMemo")}
          </h1>
          {share.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {share.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">#{tag}</span>)}
            </div>
          ) : null}
        </header>
        <div className="edgeever-editor px-1 py-4 sm:px-4 sm:py-7" data-editor-theme="default">
          <SharedDocument share={share} token={token} />
        </div>
      </article>
    </main>
  );
};
