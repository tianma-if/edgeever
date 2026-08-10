export type AiSelectionSnapshot = {
  from: number;
  to: number;
  documentFingerprint: string;
};

export const getAiDocumentFingerprint = (document: unknown) => JSON.stringify(document);

export const isAiSelectionSnapshotCurrent = (
  selection: AiSelectionSnapshot,
  document: unknown,
  documentSize: number,
) => selection.from >= 0
  && selection.to > selection.from
  && selection.to <= documentSize
  && selection.documentFingerprint === getAiDocumentFingerprint(document);
