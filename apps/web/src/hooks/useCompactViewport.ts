import { useEffect, useState } from "react";

/**
 * Tailwind's `md` breakpoint as a boolean. Below it the workspace switches to the
 * phone shell, so editors hide their wide toolbars and collapse tools into menus.
 */
export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

export function useCompactViewport() {
  const [compact, setCompact] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(COMPACT_VIEWPORT_QUERY).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const onChange = () => setCompact(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return compact;
}