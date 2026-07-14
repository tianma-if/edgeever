import { useState, useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDropzone } from "react-dropzone";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";

import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

import {
  Archive,
  HardDrive,
  ImageIcon,
  File as FileIcon,
  ExternalLink,
  ChevronLeft,
  Search,
  Grid,
  List,
  UploadCloud,
  FileText,
  FileSpreadsheet,
  FileArchive,
  Music,
  Video,
  X,
  Loader2,
  FileUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { compressImageForUpload } from "@/lib/image-compression";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import type { MemoDetail } from "@edgeever/shared";

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${exponent === 0 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)} ${units[exponent]}`;
};

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/xml",
  "text/html",
  "text/css",
  "text/javascript",
]);

const getFileIcon = (mimeType: string | null, filename: string | null) => {
  const mime = (mimeType || "").toLowerCase();
  const ext = (filename || "").split(".").pop()?.toLowerCase() || "";

  if (mime.startsWith("image/")) return <ImageIcon className="h-8 w-8 text-emerald-500" />;
  if (mime.startsWith("audio/")) return <Music className="h-8 w-8 text-sky-500" />;
  if (mime.startsWith("video/")) return <Video className="h-8 w-8 text-rose-500" />;

  if (mime === "application/pdf" || ext === "pdf") {
    return <FileText className="h-8 w-8 text-rose-600" />;
  }

  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv"
  ) {
    return <FileSpreadsheet className="h-8 w-8 text-green-600" />;
  }

  if (
    mime.includes("word") ||
    mime.includes("officedocument.wordprocessingml") ||
    ext === "doc" ||
    ext === "docx"
  ) {
    return <FileText className="h-8 w-8 text-blue-600" />;
  }

  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("rar") ||
    mime.includes("gzip") ||
    ext === "zip" ||
    ext === "rar" ||
    ext === "tar" ||
    ext === "gz"
  ) {
    return <FileArchive className="h-8 w-8 text-amber-500" />;
  }

  return <FileIcon className="h-8 w-8 text-slate-400" />;
};

interface AssetsPaneProps {
  onClose: () => void;
  activeMemo?: MemoDetail | null;
}

export const AssetsPane = ({ onClose, activeMemo }: AssetsPaneProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "image" | "document" | "other">("all");
  const [layoutMode, setLayoutMode] = useState<"grid" | "list">(() => {
    return (localStorage.getItem("assets_layout_mode") as "grid" | "list") || "grid";
  });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "compressing" | "uploading" | "error" | "success">("idle");
  const [uploadProgress, setUploadProgress] = useState("");

  // Query resources
  const resourcesQuery = useQuery({
    queryKey: ["resources"],
    queryFn: () => api.listResources(),
  });

  const resources = resourcesQuery.data?.resources ?? [];
  const summary = resourcesQuery.data?.summary ?? {
    totalCount: 0,
    totalBytes: 0,
    imageCount: 0,
    attachmentCount: 0,
  };

  // Drag and Drop Upload Handler
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      if (!activeMemo || activeMemo.isDeleted || files.length === 0) return;

      const targetMemoId = activeMemo.id;
      setUploadState("uploading");

      try {
        let count = 0;
        for (const file of files) {
          count++;
          setUploadProgress(t("assets.uploadNth", { current: count, total: files.length }));

          const isImage = file.type.startsWith("image/");
          // Compress images if enabled
          const shouldCompress = isImage;
          if (shouldCompress) {
            setUploadState("compressing");
            setUploadProgress(t("assets.compressingFile", { filename: file.name }));
          }

          const uploadFile = shouldCompress ? (await compressImageForUpload(file)).file : file;

          setUploadState("uploading");
          setUploadProgress(t("assets.uploadingFile", { filename: uploadFile.name }));

          await api.uploadMemoResource(targetMemoId, uploadFile);
        }

        void queryClient.invalidateQueries({ queryKey: ["resources"] });
        setUploadState("success");
        setTimeout(() => setUploadState("idle"), 2000);
      } catch (err) {
        setUploadState("error");
        setTimeout(() => setUploadState("idle"), 3000);
      }
    },
    [activeMemo, queryClient, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleUploadFiles,
    disabled: !activeMemo || activeMemo.isDeleted,
    noClick: true,
  });

  // Filter Logic
  const filteredResources = useMemo(() => {
    return resources.filter((resource) => {
      // 1. Kind/Type Filter
      const isDoc = DOCUMENT_MIME_TYPES.has(resource.mimeType || "") || resource.kind === "attachment";
      if (filterType === "image" && resource.kind !== "image") return false;
      if (filterType === "document" && (!isDoc || resource.kind === "image")) return false;
      if (filterType === "other" && (resource.kind === "image" || isDoc)) return false;

      // 2. Search Text Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const filenameMatch = (resource.filename || "").toLowerCase().includes(query);
        const memoTitleMatch = (resource.memoTitle || "").toLowerCase().includes(query);
        const memoExcerptMatch = (resource.memoExcerpt || "").toLowerCase().includes(query);
        return filenameMatch || memoTitleMatch || memoExcerptMatch;
      }

      return true;
    });
  }, [resources, filterType, searchQuery]);

  // Lightbox slides
  const imageResources = useMemo(() => {
    return filteredResources.filter((r) => r.kind === "image");
  }, [filteredResources]);

  const slides = useMemo(() => {
    return imageResources.map((r) => ({
      src: r.url,
      alt: r.filename || "",
      title: r.filename || "",
    }));
  }, [imageResources]);

  const handleImageClick = (resourceId: string) => {
    const idx = imageResources.findIndex((r) => r.id === resourceId);
    if (idx !== -1) {
      setLightboxIndex(idx);
    }
  };

  const handleManualUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleManualFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(Array.from(e.target.files));
    }
  };

  const activeMemoTitle = activeMemo?.title || activeMemo?.excerpt || t("assets.unnamedMemo");
  const activeMemoShortTitle = activeMemo?.title || activeMemo?.excerpt || t("assets.unnamedShort");
  const getResourceMemoSource = (resource: { memoDeleted: boolean; memoTitle: string | null; memoExcerpt: string | null; memoId: string }) =>
    resource.memoDeleted ? t("assets.deletedMemo") : resource.memoTitle || resource.memoExcerpt || resource.memoId;

  return (
    <div
      {...getRootProps()}
      className="relative flex h-full min-h-0 flex-col bg-white select-none outline-none"
    >
      <input {...getInputProps()} />

      {/* Header */}
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 px-6 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:pb-0 lg:pt-0">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            title={t("common.back")}
            aria-label={t("common.back")}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <Archive className="h-4.5 w-4.5 text-emerald-700" />
              {t("assets.title")}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider">
              <span className="inline-flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                {formatBytes(summary.totalBytes)}
              </span>
              <span>•</span>
              <span>{t("assets.fileCount", { count: summary.totalCount })}</span>
              <span>•</span>
              <span>{t("assets.imageCount", { count: summary.imageCount })}</span>
            </p>
          </div>
        </div>
      </header>

      {/* Toolbar (Filters, Search, Layout mode) */}
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-white p-4 shrink-0 sm:flex-row sm:items-center sm:justify-between">
        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {(["all", "image", "document", "other"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                filterType === type
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
                  : "text-slate-500 hover:bg-slate-50 border border-transparent"
              }`}
            >
              {t(`assets.filters.${type}`)}
            </button>
          ))}
        </div>

        {/* Search & Layout Toggles */}
        <div className="flex items-center gap-2">
          {/* Search box */}
          <div className="relative flex-1 sm:w-60">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t("assets.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8.5 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-8.5 pr-8 text-xs text-slate-800 placeholder-slate-400 transition-colors focus:border-emerald-500/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-650"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Layout switches */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5 bg-slate-50/50">
            <button
              onClick={() => setLayoutMode("grid")}
              title={t("assets.gridView")}
              className={`rounded-md p-1 transition-colors ${
                layoutMode === "grid" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setLayoutMode("list")}
              title={t("assets.listView")}
              className={`rounded-md p-1 transition-colors ${
                layoutMode === "list" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Target Upload Memo Info Banner */}
      {activeMemo ? (
        <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50/30 px-6 py-2 shrink-0">
          <p className="truncate text-[11px] font-medium text-emerald-800">
            {t("assets.activeMemo", { title: activeMemoTitle })}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleManualFileChange}
              multiple
              className="hidden"
            />
            <button
              onClick={handleManualUploadClick}
              disabled={uploadState !== "idle"}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-450"
            >
              {uploadState === "idle" ? (
                <>
                  <FileUp className="h-3 w-3" />
                  {t("assets.uploadAttachment")}
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("assets.processing")}
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-b border-amber-100 bg-amber-50/30 px-6 py-2 text-[11px] font-medium text-amber-800 shrink-0">
          {t("assets.noActiveMemoHint")}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-slate-50/30 p-6">
        <div className="mx-auto max-w-4xl">
          {resourcesQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-32 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-2" />
              <span className="text-xs font-medium">{t("assets.loading")}</span>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white px-6 py-24 text-center">
              <Archive className="h-10 w-10 text-slate-350 mb-3 stroke-[1.5]" />
              <p className="text-sm font-semibold text-slate-500">
                {searchQuery || filterType !== "all" ? t("assets.noMatches") : t("assets.empty")}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {searchQuery || filterType !== "all"
                  ? t("assets.noMatchesDescription")
                  : t("assets.emptyDescription")}
              </p>
            </div>
          ) : layoutMode === "grid" ? (
            /* Grid View */
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {filteredResources.map((resource) => (
                <div
                  key={resource.id}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-emerald-500/40 hover:shadow-md"
                >
                  {/* Thumbnail area */}
                  <div
                    onClick={() => {
                      if (resource.kind === "image") {
                        handleImageClick(resource.id);
                      } else {
                        window.open(resource.url, "_blank", "noreferrer");
                      }
                    }}
                    className="relative aspect-square w-full cursor-pointer overflow-hidden bg-slate-50 flex items-center justify-center border-b border-slate-100"
                  >
                    {resource.kind === "image" ? (
                      <img
                        src={resource.url}
                        alt={resource.filename || ""}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-103"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 p-3 text-center">
                        {getFileIcon(resource.mimeType, resource.filename)}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                          {(resource.filename || "").split(".").pop() || "FILE"}
                        </span>
                      </div>
                    )}
                    {/* Hover detail overlay */}
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100 flex items-center justify-center">
                      <span className="rounded bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 shadow flex items-center gap-1">
                        {resource.kind === "image" ? t("assets.previewImage") : t("assets.downloadOpen")}
                        <ExternalLink className="h-3 w-3" />
                      </span>
                    </div>
                  </div>

                  {/* Metadata area */}
                  <div className="flex flex-col p-3 min-w-0">
                    <span
                      title={resource.filename || resource.id}
                      className="truncate text-xs font-bold text-slate-800 leading-snug group-hover:text-emerald-700 transition-colors"
                    >
                      {resource.filename || resource.id}
                    </span>
                    <span className="mt-1 flex items-center justify-between text-[10px] font-medium text-slate-400">
                      <span>{formatBytes(resource.byteSize)}</span>
                      <span>{(resource.mimeType?.split("/")[1] || resource.kind).toUpperCase()}</span>
                    </span>
                    <span
                      title={
                        resource.memoDeleted
                          ? t("assets.deletedMemo")
                          : t("assets.fromMemo", { source: resource.memoTitle || resource.memoExcerpt || resource.memoId })
                      }
                      className="mt-1.5 truncate text-[9px] text-slate-400 border-t border-slate-50 pt-1"
                    >
                      📄 {resource.memoDeleted ? t("assets.deletedMemo") : resource.memoTitle || resource.memoExcerpt || t("assets.unnamedMemo")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="flex flex-col gap-2.5">
              {filteredResources.map((resource) => (
                <div
                  key={resource.id}
                  className="group relative flex items-center gap-3.5 rounded-xl border border-slate-200/80 bg-white p-3.5 text-left transition-all duration-200 hover:border-emerald-500/35 hover:shadow-sm"
                >
                  {/* Left Icon/Thumbnail */}
                  <div
                    onClick={() => {
                      if (resource.kind === "image") {
                        handleImageClick(resource.id);
                      } else {
                        window.open(resource.url, "_blank", "noreferrer");
                      }
                    }}
                    className="relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-slate-50/50"
                  >
                    {resource.kind === "image" ? (
                      <img
                        src={resource.url}
                        alt={resource.filename || ""}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      getFileIcon(resource.mimeType, resource.filename)
                    )}
                  </div>

                  {/* Mid Info */}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800 leading-snug group-hover:text-emerald-700 transition-colors">
                      {resource.filename || resource.id}
                    </span>
                    <span className="mt-1 block truncate text-[11px] font-medium text-slate-400">
                      {formatBytes(resource.byteSize)} · {resource.mimeType?.split("/")[1] || resource.kind} ·{" "}
                      {formatDateTime(resource.createdAt)}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-slate-500">
                      {t("assets.sourceMemo", { source: getResourceMemoSource(resource) })}
                    </span>
                  </div>

                  {/* Right Actions */}
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    title={t("assets.openInNewWindow")}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-350 hover:bg-slate-50 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all duration-150"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drag Active Overlay */}
      {isDragActive && activeMemo && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-emerald-900/80 backdrop-blur-sm p-6 text-center text-white transition-all duration-200">
          <div className="rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-950/40 p-12 flex flex-col items-center max-w-md shadow-2xl">
            <UploadCloud className="h-16 w-16 text-emerald-300 animate-bounce mb-4" />
            <h3 className="text-lg font-bold">{t("assets.dropTitle")}</h3>
            <p className="mt-2 text-sm text-emerald-200 leading-relaxed">
              {t("assets.dropDescription")}
              <span className="block mt-1 font-bold text-white">{activeMemoShortTitle}</span>
            </p>
          </div>
        </div>
      )}

      {/* Uploading Status Overlay (Non-intrusive bottom loader) */}
      {uploadState !== "idle" && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-5 py-3.5 shadow-xl backdrop-blur-sm">
          {uploadState === "compressing" && (
            <>
              <Loader2 className="h-4.5 w-4.5 animate-spin text-emerald-650" />
              <span className="text-xs font-semibold text-slate-700">{uploadProgress}</span>
            </>
          )}
          {uploadState === "uploading" && (
            <>
              <Loader2 className="h-4.5 w-4.5 animate-spin text-emerald-650" />
              <span className="text-xs font-semibold text-slate-700">{uploadProgress}</span>
            </>
          )}
          {uploadState === "success" && (
            <>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-650 text-xs font-bold font-mono">✓</span>
              <span className="text-xs font-semibold text-emerald-700">{t("assets.uploadSuccess")}</span>
            </>
          )}
          {uploadState === "error" && (
            <>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-rose-600 text-xs font-bold font-mono">✕</span>
              <span className="text-xs font-semibold text-rose-700">{t("assets.uploadError")}</span>
            </>
          )}
        </div>
      )}

      {/* Lightbox Viewer */}
      {lightboxIndex !== null && (
        <Lightbox
          index={lightboxIndex}
          slides={slides}
          open={lightboxIndex !== null}
          close={() => setLightboxIndex(null)}
          plugins={[Zoom, Thumbnails]}
        />
      )}
    </div>
  );
};
