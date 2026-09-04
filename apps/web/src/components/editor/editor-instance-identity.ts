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
