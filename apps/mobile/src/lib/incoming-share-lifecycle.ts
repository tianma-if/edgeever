export type ClearIncomingSharePayloads = () => void;
export type RefreshIncomingSharePayloads = () => void | Promise<void>;

export const clearAndRefreshIncomingShare = (
  clearSharedPayloads: ClearIncomingSharePayloads,
  refreshSharePayloads: RefreshIncomingSharePayloads,
) => {
  clearSharedPayloads();
  return refreshSharePayloads();
};
