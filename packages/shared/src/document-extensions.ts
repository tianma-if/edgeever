import type { AnyExtension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { createEdgeEverDetailsExtensions } from "./details";
import { FileAttachment } from "./file-attachment";
import { ImageGallery } from "./image-gallery";
import { MergeDivider } from "./merge-divider";
import { PdfAttachment } from "./pdf-attachment";
import { PluginEmbed } from "./plugin-embed";
import { EmptyExternalLink } from "./empty-external-link";
import { EdgeEverLink } from "./editor-link";
import { createEdgeEverTaskItem } from "./task-item-input";
import { MathCodeFence } from "./mathematics-markdown";

export type CreateEdgeEverDocumentExtensionsOptions = {
  mathematics: AnyExtension[];
  starterKit?: Parameters<typeof StarterKit.configure>[0];
  image?: AnyExtension | false;
  gallery?: AnyExtension | false;
  pdf?: AnyExtension | false;
  file?: AnyExtension | false;
  pluginEmbed?: AnyExtension | false;
  table?: Parameters<typeof TableKit.configure>[0];
  markdown?: boolean;
};

const withOptional = (value: AnyExtension | false | undefined, fallback: AnyExtension) => {
  if (value === false) return [];
  return [value ?? fallback];
};

/**
 * Document-schema TipTap extensions shared by Markdown codecs and editors.
 * Pass KaTeX math from `@edgeever/shared/mathematics` in browsers; Worker
 * codecs must keep using `createEdgeEverMarkdownMathematics()`.
 */
export const createEdgeEverDocumentExtensions = (
  options: CreateEdgeEverDocumentExtensionsOptions,
): AnyExtension[] => [
  options.markdown
    ? StarterKit.configure({ ...options.starterKit, link: false })
    : options.starterKit === undefined ? StarterKit : StarterKit.configure(options.starterKit),
  ...(options.markdown ? [EdgeEverLink] : []),
  EmptyExternalLink,
  TaskList,
  createEdgeEverTaskItem(),
  options.table === undefined ? TableKit : TableKit.configure(options.table),
  ...withOptional(options.image, Image),
  ...withOptional(options.gallery, ImageGallery),
  ...withOptional(options.pdf, PdfAttachment),
  ...withOptional(options.file, FileAttachment),
  MergeDivider,
  ...createEdgeEverDetailsExtensions(),
  ...withOptional(options.pluginEmbed, PluginEmbed),
  ...options.mathematics,
  MathCodeFence,
  ...(options.markdown
    ? [Markdown.configure({ markedOptions: { gfm: true } })]
    : []),
];
