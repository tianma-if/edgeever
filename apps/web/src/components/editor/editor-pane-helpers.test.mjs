import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  resetEditorDocument,
  handleResourceFileDrop,
  shouldInsertDroppedResourceFiles,
  shouldRetryCreatedMemoFocus,
} from "./editor-pane-helpers.ts";

describe("created memo focus retry", () => {
  test("keeps retrying until the editor is hydrated, editable, and focused", () => {
    expect(shouldRetryCreatedMemoFocus({
      attempt: 0,
      editorReady: false,
      editorEditable: false,
      editorFocused: false,
      hydratedForMemo: false,
    })).toBe(true);
    expect(shouldRetryCreatedMemoFocus({
      attempt: 3,
      editorReady: true,
      editorEditable: false,
      editorFocused: false,
      hydratedForMemo: true,
    })).toBe(true);
    expect(shouldRetryCreatedMemoFocus({
      attempt: 4,
      editorReady: true,
      editorEditable: true,
      editorFocused: false,
      hydratedForMemo: true,
    })).toBe(true);
    expect(shouldRetryCreatedMemoFocus({
      attempt: 5,
      editorReady: true,
      editorEditable: true,
      editorFocused: true,
      hydratedForMemo: true,
    })).toBe(false);
  });

  test("stops retrying after the attempt budget", () => {
    expect(shouldRetryCreatedMemoFocus({
      attempt: 120,
      editorReady: true,
      editorEditable: false,
      editorFocused: false,
      hydratedForMemo: true,
    })).toBe(false);
  });
});

describe("dropped resource files", () => {
  const fileTransfer = {
    items: [{ kind: "file", getAsFile: () => new File(["png"], "preview.png", { type: "image/png" }) }],
    files: [],
  };

  test("inserts clipboard or OS files", () => {
    expect(shouldInsertDroppedResourceFiles({
      dataTransfer: fileTransfer,
      isInternalNodeDrag: false,
    })).toBe(true);
  });

  test("does not steal a block-handle drop that Chrome tagged with a preview file", () => {
    expect(shouldInsertDroppedResourceFiles({
      dataTransfer: fileTransfer,
      isInternalNodeDrag: true,
    })).toBe(false);
  });
});

describe("resource drops across the editor canvas", () => {
  const files = [new File(["pdf"], "document.pdf", { type: "application/pdf" })];
  const setup = ({ position = null, editable = true, dragging = null } = {}) => {
    const event = {
      dataTransfer: { files }, clientX: 24, clientY: 800,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    const view = { editable, dragging, state: { doc: { content: { size: 17 } } },
      posAtCoords: () => position === null ? null : { pos: position } };
    const inserted = [];
    const insert = (files, position) => { inserted.push({ files, position }); return true; };
    return { event, view, inserted, insert };
  };

  test("appends a PDF dropped in blank canvas without replacing selected text", () => {
    const { event, view, inserted, insert } = setup();
    expect(handleResourceFileDrop(view, event, insert)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(inserted).toEqual([{ files, position: 17 }]);
  });

  test("uses the document drop position and inserts only once when bubbling", () => {
    const { event, view, inserted, insert } = setup({ position: 4 });
    expect(handleResourceFileDrop(view, event, insert)).toBe(true);
    expect(handleResourceFileDrop(view, event, insert)).toBe(false);
    expect(inserted).toEqual([{ files, position: 4 }]);
  });

  test("preserves internal node drags and read-only notes", () => {
    for (const options of [{ dragging: {} }, { editable: false }]) {
      const { event, view, inserted, insert } = setup(options);
      expect(handleResourceFileDrop(view, event, insert)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(inserted).toEqual([]);
    }
  });

  test("leaves text and empty file drops alone", () => {
    const { event, view, inserted, insert } = setup();
    event.dataTransfer = { files: [] };
    expect(handleResourceFileDrop(view, event, insert)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(inserted).toEqual([]);
  });
});

describe("editor outline demo preference wiring", () => {
  test("defaults outline to expanded in demo mode when unset and resets on demo restore", () => {
    const editorSource = readFileSync(new URL("../EditorPane.tsx", import.meta.url), "utf8");
    const workspaceSource = readFileSync(new URL("../WorkspaceApp.tsx", import.meta.url), "utf8");

    expect(editorSource).toContain("readEditorOutlineCollapsedPreference({ defaultCollapsed: !demoMode })");
    expect(workspaceSource).toContain("demoMode={demoMode}");
    expect(workspaceSource).toContain("window.localStorage.removeItem(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY)");
  });
});

describe("collapsed outline entry", () => {
  test("pins the collapsed button to the editor pane instead of the scrolling note", () => {
    const editorSource = readFileSync(new URL("../EditorPane.tsx", import.meta.url), "utf8");
    const outlineSource = readFileSync(new URL("../EditorOutline.tsx", import.meta.url), "utf8");

    expect(editorSource).toContain('data-editor-outline-anchor="collapsed"');
    expect(editorSource).toContain("collapsedAnchor={collapsedOutlineAnchor}");
    expect(outlineSource).toContain("createPortal(outline, collapsedAnchor)");
    expect(outlineSource).not.toContain("absolute right-0 top-6");
  });
});


test('document reset keeps reused image sources, releases removed media and clears undo history',async()=>{
 const {parseHTML}=await import('linkedom'),{Schema}=await import('@tiptap/pm/model'),{EditorView}=await import('@tiptap/pm/view'),{EditorState}=await import('@tiptap/pm/state'),{history,undoDepth}=await import('@tiptap/pm/history');
 const {window}=parseHTML('<html><body><div id="editor"></div></body></html>');
 const values={window,document:window.document,Node:window.Node,HTMLElement:window.HTMLElement,Element:window.Element,MutationObserver:window.MutationObserver,getComputedStyle:()=>({whiteSpace:'pre-wrap'}),navigator:{userAgent:'test'}};
 const originals=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 let view;
 try {
  const schema=new Schema({nodes:{doc:{content:'block*'},paragraph:{content:'text*',group:'block',toDOM:()=>['p',0]},text:{group:'inline'},image:{group:'block',attrs:{src:{}},toDOM:node=>['img',{src:node.attrs.src}]}}});
  const content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'One'}]},{type:'image',attrs:{src:'/api/v1/resources/test/blob'}}]};
  view=new EditorView(window.document.getElementById('editor'),{state:EditorState.create({schema,doc:schema.nodeFromJSON(content),plugins:[history()]})});
  const editor={view,schema,get state(){return view.state;}};
  view.dispatch(view.state.tr.insertText(' edit',4));expect(undoDepth(view.state)).toBe(1);
  const image=view.dom.querySelector('img');resetEditorDocument(editor,content);
  expect(view.dom.querySelector('img')).toBe(image);expect(image.getAttribute('src')).toBe('/api/v1/resources/test/blob');expect(undoDepth(view.state)).toBe(0);
  resetEditorDocument(editor,{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Another memo'}]}]});
  expect(view.dom.querySelector('img')).toBeNull();expect(image.getAttribute('src')).toBe('');
 } finally {
  view?.destroy();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});
