export type EditorInstanceMemoIdentity = {
  memoId: string | null;
  instanceKey: string | null;
  aliases: ReadonlySet<string>;
};

export const createEditorInstanceMemoIdentity = (
  memoId: string | null,
): EditorInstanceMemoIdentity => ({
  memoId,
  instanceKey: memoId,
  aliases: new Set(memoId ? [memoId] : []),
});

export const reconcileEditorInstanceMemoIdentity = (
  identity: EditorInstanceMemoIdentity,
  memoId: string | null,
): EditorInstanceMemoIdentity => (
  identity.memoId === memoId || Boolean(memoId && identity.aliases.has(memoId))
)
  ? identity
  : createEditorInstanceMemoIdentity(memoId);

export const isEditorInstanceHydratedForMemo = (
  identity: EditorInstanceMemoIdentity,
  hydratedMemoId: string | null,
  renderedMemoId: string | null,
) => Boolean(
  hydratedMemoId
  && renderedMemoId
  && identity.aliases.has(hydratedMemoId)
  && identity.aliases.has(renderedMemoId)
);

export const remapEditorInstanceMemoIdentity = (
  identity: EditorInstanceMemoIdentity,
  memoIdMappings: ReadonlyMap<string, string>,
): EditorInstanceMemoIdentity => {
  if (!identity.memoId) return identity;

  const remappedMemoId = memoIdMappings.get(identity.memoId);
  if (!remappedMemoId || remappedMemoId === identity.memoId) return identity;

  return {
    memoId: remappedMemoId,
    instanceKey: identity.instanceKey,
    aliases: new Set([...identity.aliases, remappedMemoId]),
  };
};
