import { Bold, Check, ChevronDown, ImagePlus, List, ListIndentDecrease, ListIndentIncrease, ListTodo, Minus, Quote } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  MOBILE_EDITOR_TOOLBAR_ACTIONS,
  getMobileEditorToolbarActionLabel,
  type MobileEditorLocale,
  type MobileEditorToolbarActionId,
} from "@edgeever/shared/mobile-editor";
import type { ReactNode } from "react";
import type { NotebookMoveOption } from "@/lib/app-helpers";
import type { MobileEditorSaveState } from "@/lib/mobile-editor-standalone";

export const MobileEditorHeader = ({
  saveLabel,
  statusClassName,
  saveState,
  onLeave,
}: {
  saveLabel: string;
  statusClassName: string;
  saveState: MobileEditorSaveState;
  onLeave: () => void;
}) => (
  <MobileEditorHeaderInner saveLabel={saveLabel} statusClassName={statusClassName} saveState={saveState} onLeave={onLeave} />
);

const MobileEditorHeaderInner = ({
  saveLabel,
  statusClassName,
  saveState,
  onLeave,
}: {
  saveLabel: string;
  statusClassName: string;
  saveState: MobileEditorSaveState;
  onLeave: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <header className="mobile-editor-header">
      <button className="mobile-editor-back" type="button" aria-label={t("editor.backToList")} onClick={onLeave}>
        ‹
      </button>
      <div className="mobile-editor-actions">
        <span className={`mobile-editor-status ${statusClassName}`}>{saveLabel}</span>
        <button className="mobile-editor-done" type="button" disabled={saveState === "loading"} onClick={onLeave}>
          {t("editor.done")}
        </button>
      </div>
    </header>
  );
};

export const MobileEditorToolbar = ({
  disabled,
  boldActive,
  bulletListActive,
  taskListActive,
  increaseListIndentAvailable,
  decreaseListIndentAvailable,
  blockquoteActive,
  locale,
  onPickImage,
  onToggleBold,
  onToggleBulletList,
  onToggleTaskList,
  onIncreaseListIndent,
  onDecreaseListIndent,
  onToggleBlockquote,
  onSetHorizontalRule,
}: {
  disabled: boolean;
  boldActive: boolean;
  bulletListActive: boolean;
  taskListActive: boolean;
  increaseListIndentAvailable: boolean;
  decreaseListIndentAvailable: boolean;
  blockquoteActive: boolean;
  locale: MobileEditorLocale;
  onPickImage: () => void;
  onToggleBold: () => void;
  onToggleBulletList: () => void;
  onToggleTaskList: () => void;
  onIncreaseListIndent: () => void;
  onDecreaseListIndent: () => void;
  onToggleBlockquote: () => void;
  onSetHorizontalRule: () => void;
}) => {
  const icons: Record<MobileEditorToolbarActionId, ReactNode> = {
    image: <ImagePlus aria-hidden="true" size={18} strokeWidth={2} />,
    bold: <Bold aria-hidden="true" size={17} strokeWidth={2.4} />,
    bulletList: <List aria-hidden="true" size={18} strokeWidth={2.2} />,
    taskList: <ListTodo aria-hidden="true" size={18} strokeWidth={2.1} />,
    increaseListIndent: <ListIndentIncrease aria-hidden="true" size={18} strokeWidth={2.1} />,
    decreaseListIndent: <ListIndentDecrease aria-hidden="true" size={18} strokeWidth={2.1} />,
    blockquote: <Quote aria-hidden="true" size={17} strokeWidth={2.2} />,
    horizontalRule: <Minus aria-hidden="true" size={18} strokeWidth={2.4} />,
  };
  const handlers: Record<MobileEditorToolbarActionId, () => void> = {
    image: onPickImage,
    bold: onToggleBold,
    bulletList: onToggleBulletList,
    taskList: onToggleTaskList,
    increaseListIndent: onIncreaseListIndent,
    decreaseListIndent: onDecreaseListIndent,
    blockquote: onToggleBlockquote,
    horizontalRule: onSetHorizontalRule,
  };
  const activeStates: Partial<Record<MobileEditorToolbarActionId, boolean>> = {
    bold: boldActive,
    bulletList: bulletListActive,
    taskList: taskListActive,
    blockquote: blockquoteActive,
  };

  return (
    <div className="mobile-editor-tool-row">
      {MOBILE_EDITOR_TOOLBAR_ACTIONS.map(({ id }) => {
        const label = getMobileEditorToolbarActionLabel(id, locale);

        return (
          <button
            key={id}
            className="mobile-editor-tool-button"
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={activeStates[id]}
            disabled={disabled
              || (id === "increaseListIndent" && !increaseListIndentAvailable)
              || (id === "decreaseListIndent" && !decreaseListIndentAvailable)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={handlers[id]}
          >
            {icons[id]}
          </button>
        );
      })}
    </div>
  );
};

export const MobileEditorNotebookButton = ({
  label,
  disabled,
  onOpen,
}: {
  label: string;
  disabled: boolean;
  onOpen: () => void;
}) => (
  <MobileEditorNotebookButtonInner label={label} disabled={disabled} onOpen={onOpen} />
);

const MobileEditorNotebookButtonInner = ({ label, disabled, onOpen }: { label: string; disabled: boolean; onOpen: () => void }) => {
  const { t } = useTranslation();

  return (
    <button className="mobile-editor-notebook-button" type="button" aria-label={t("editor.currentNotebook")} disabled={disabled} onClick={onOpen}>
      <span>{label}</span>
      <ChevronDown aria-hidden="true" size={14} strokeWidth={2.2} />
    </button>
  );
};

export const MobileEditorNotebookSheet = ({
  options,
  selectedNotebookId,
  updating,
  onClose,
  onSelect,
}: {
  options: NotebookMoveOption[];
  selectedNotebookId?: string;
  updating: boolean;
  onClose: () => void;
  onSelect: (notebookId: string) => void;
}) => (
  <MobileEditorNotebookSheetInner
    options={options}
    selectedNotebookId={selectedNotebookId}
    updating={updating}
    onClose={onClose}
    onSelect={onSelect}
  />
);

const MobileEditorNotebookSheetInner = ({
  options,
  selectedNotebookId,
  updating,
  onClose,
  onSelect,
}: {
  options: NotebookMoveOption[];
  selectedNotebookId?: string;
  updating: boolean;
  onClose: () => void;
  onSelect: (notebookId: string) => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="mobile-editor-sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="mobile-editor-notebook-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("editor.currentNotebook")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-editor-notebook-sheet-handle" aria-hidden="true" />
        <div className="mobile-editor-notebook-sheet-header">
          <h2>{t("editor.currentNotebook")}</h2>
          <button type="button" onClick={onClose}>
            {t("editor.close")}
          </button>
        </div>
        <div className="mobile-editor-notebook-list">
          {options.map((notebook) => {
            const selected = notebook.id === selectedNotebookId;

            return (
              <button
                key={notebook.id}
                className="mobile-editor-notebook-option"
                type="button"
                aria-current={selected ? "page" : undefined}
                disabled={updating}
                style={{ paddingLeft: `${16 + notebook.depth * 18}px` }}
                onClick={() => onSelect(notebook.id)}
              >
                <span>{notebook.name}</span>
                {selected && <Check aria-hidden="true" size={16} strokeWidth={2.4} />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export const MobileEditorFallback = ({ markdown }: { markdown: string }) => {
  const { t } = useTranslation();

  return (
    <details className="mobile-editor-fallback">
      <summary>{`${t("editor.noteBodyAria")} Markdown`}</summary>
      <pre>{markdown}</pre>
    </details>
  );
};
