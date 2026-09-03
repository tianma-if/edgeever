import { useCallback, useReducer } from "react";

export type ResourceMenuPosition = {
  left: number;
  top: number;
  placement: "above" | "below" | "inside-bottom-right";
};

export type AttachmentMenuTarget = {
  kind: "attachment";
  url: string;
  filename: string;
  resourceId: string | null;
  position: ResourceMenuPosition;
};

export type ImageMenuTarget = {
  kind: "image";
  element?: HTMLElement;
  url: string;
  filename: string;
  resourceId: string | null;
  position: ResourceMenuPosition;
  updateAttributes: (attributes: Record<string, unknown>) => void;
  deleteNode: () => void;
};

export type ResourceMenuTarget = AttachmentMenuTarget | ImageMenuTarget;
export type ResourceDialogState = { action: "rename" | "delete"; target: ResourceMenuTarget };

export type EditorResourceActionState = {
  menuTarget: ResourceMenuTarget | null;
  dialog: ResourceDialogState | null;
  filename: string;
  pending: boolean;
  error: string | null;
};

export type EditorResourceAction =
  | { type: "show-menu"; target: ResourceMenuTarget }
  | { type: "hide-menu" }
  | { type: "open-dialog"; action: ResourceDialogState["action"]; target: ResourceMenuTarget }
  | { type: "close-dialog" }
  | { type: "set-filename"; filename: string }
  | { type: "start" }
  | { type: "complete" }
  | { type: "fail"; error: string }
  | { type: "clear-error" }
  | { type: "reset" };

export const initialEditorResourceActionState: EditorResourceActionState = {
  menuTarget: null,
  dialog: null,
  filename: "",
  pending: false,
  error: null,
};

export const editorResourceActionReducer = (
  state: EditorResourceActionState,
  action: EditorResourceAction,
): EditorResourceActionState => {
  switch (action.type) {
    case "show-menu": return { ...state, menuTarget: action.target };
    case "hide-menu": return { ...state, menuTarget: null };
    case "open-dialog": return {
      menuTarget: null,
      dialog: { action: action.action, target: action.target },
      filename: action.target.filename,
      pending: false,
      error: null,
    };
    case "close-dialog": return state.pending ? state : { ...state, dialog: null };
    case "set-filename": return { ...state, filename: action.filename };
    case "start": return { ...state, pending: true, error: null };
    case "complete": return { ...state, dialog: null, pending: false, error: null };
    case "fail": return { ...state, pending: false, error: action.error };
    case "clear-error": return { ...state, error: null };
    case "reset": return initialEditorResourceActionState;
  }
};

export const useEditorResourceActions = () => {
  const [state, dispatch] = useReducer(editorResourceActionReducer, initialEditorResourceActionState);
  return {
    ...state,
    clearError: useCallback(() => dispatch({ type: "clear-error" }), []),
    closeDialog: useCallback(() => dispatch({ type: "close-dialog" }), []),
    completeAction: useCallback(() => dispatch({ type: "complete" }), []),
    failAction: useCallback((error: string) => dispatch({ type: "fail", error }), []),
    hideMenu: useCallback(() => dispatch({ type: "hide-menu" }), []),
    openDialog: useCallback((action: ResourceDialogState["action"], target: ResourceMenuTarget) => {
      dispatch({ type: "open-dialog", action, target });
    }, []),
    reset: useCallback(() => dispatch({ type: "reset" }), []),
    setFilename: useCallback((filename: string) => dispatch({ type: "set-filename", filename }), []),
    showMenu: useCallback((target: ResourceMenuTarget) => dispatch({ type: "show-menu", target }), []),
    startAction: useCallback(() => dispatch({ type: "start" }), []),
  };
};
