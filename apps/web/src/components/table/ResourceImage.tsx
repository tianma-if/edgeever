import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { loadImagePreview, peekImagePreview } from "@/lib/image-preview";

type ResourceImageProps = {
  /** Resource whose blob should be shown. */
  resourceId: string;
  /** Rendered width in CSS pixels; also picks the preview cache bucket. */
  width: number;
  className?: string;
  alt?: string;
};

/**
 * Renders a resource image from a downscaled preview so cards never paint a
 * multi-megapixel bitmap. While the preview is being built the box keeps its
 * size with a muted placeholder, which keeps layout and hover geometry stable.
 */
export const ResourceImage = ({ resourceId, width, className, alt = "" }: ResourceImageProps) => {
  const [src, setSrc] = useState<string | null>(() => peekImagePreview(resourceId, width));

  useEffect(() => {
    let active = true;
    const cached = peekImagePreview(resourceId, width);
    if (cached) {
      setSrc(cached);
      return;
    }
    setSrc(null);
    void loadImagePreview(resourceId, width).then((url) => {
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [resourceId, width]);

  if (!src) {
    return <span className={cn("block h-full w-full bg-muted/60", className)} aria-hidden="true" data-testid="resource-image-placeholder" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-testid="resource-image"
      className={cn("h-full w-full object-cover", className)}
    />
  );
};