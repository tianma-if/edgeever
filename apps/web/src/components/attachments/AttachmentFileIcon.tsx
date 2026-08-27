import {
  File,
  FileArchive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Music,
  Presentation,
  Video,
} from "lucide-react";
import { resolveAttachmentKind } from "@edgeever/shared";
import { cn } from "@/lib/utils";

export const AttachmentFileIcon = ({
  mimeType,
  filename,
  className,
}: {
  mimeType?: string | null;
  filename?: string | null;
  className?: string;
}) => {
  const kind = resolveAttachmentKind(mimeType, filename);
  const commonClassName = cn("h-8 w-8 shrink-0", className);

  switch (kind) {
    case "image": return <ImageIcon className={cn(commonClassName, "text-emerald-500")} aria-hidden="true" />;
    case "audio": return <Music className={cn(commonClassName, "text-sky-500")} aria-hidden="true" />;
    case "video": return <Video className={cn(commonClassName, "text-rose-500")} aria-hidden="true" />;
    case "pdf": return <FileText className={cn(commonClassName, "text-rose-600")} aria-hidden="true" />;
    case "spreadsheet": return <FileSpreadsheet className={cn(commonClassName, "text-green-600")} aria-hidden="true" />;
    case "document": return <FileText className={cn(commonClassName, "text-blue-600")} aria-hidden="true" />;
    case "presentation": return <Presentation className={cn(commonClassName, "text-orange-500")} aria-hidden="true" />;
    case "archive": return <FileArchive className={cn(commonClassName, "text-amber-500")} aria-hidden="true" />;
    case "code": return <FileCode2 className={cn(commonClassName, "text-violet-500")} aria-hidden="true" />;
    case "text": return <FileText className={cn(commonClassName, "text-slate-500")} aria-hidden="true" />;
    default: return <File className={cn(commonClassName, "text-slate-400")} aria-hidden="true" />;
  }
};
