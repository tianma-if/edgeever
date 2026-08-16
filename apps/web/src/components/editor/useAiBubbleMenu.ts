import { useCallback, useEffect, useState } from "react";
import type { BubbleMenuProps } from "@tiptap/react/menus";
import {
  AI_SELECTION_MENU_CHANGED_EVENT,
  readAiSelectionMenuPreference,
} from "@/lib/ai-selection-menu-preference";

type BubbleMenuShouldShow = NonNullable<BubbleMenuProps["shouldShow"]>;
type BubbleMenuOptions = NonNullable<BubbleMenuProps["options"]>;

const AI_BUBBLE_MENU_OPTIONS: BubbleMenuOptions = { placement: "top" };

export const shouldShowAiBubbleMenu = ({
  assistantOpen,
  editable,
  enabled,
  selectionEmpty,
}: {
  assistantOpen: boolean;
  editable: boolean;
  enabled: boolean;
  selectionEmpty: boolean;
}): boolean => enabled && editable && !selectionEmpty && !assistantOpen;

export const useAiBubbleMenu = (assistantOpen: boolean) => {
  const [enabled, setEnabled] = useState(readAiSelectionMenuPreference);

  useEffect(() => {
    const syncPreference = () => setEnabled(readAiSelectionMenuPreference());
    const handlePreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") {
        setEnabled(detail);
        return;
      }
      syncPreference();
    };
    window.addEventListener(AI_SELECTION_MENU_CHANGED_EVENT, handlePreferenceChanged);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(AI_SELECTION_MENU_CHANGED_EVENT, handlePreferenceChanged);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  // BubbleMenu dispatches an options-update transaction whenever these prop
  // references change. Keep them stable so the editor's transaction-driven
  // toolbar refresh cannot feed back into another BubbleMenu update.
  const shouldShow = useCallback<BubbleMenuShouldShow>(
    ({ editor }) => shouldShowAiBubbleMenu({
      assistantOpen,
      editable: editor.isEditable,
      enabled,
      selectionEmpty: editor.state.selection.empty,
    }),
    [assistantOpen, enabled],
  );

  return {
    options: AI_BUBBLE_MENU_OPTIONS,
    shouldShow,
  };
};
