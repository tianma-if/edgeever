export const acknowledgeTableUploads = (
  pending: Set<string>,
  saved: ReadonlySet<string>,
  current: ReadonlySet<string>,
) => {
  const abandoned: string[] = [];
  for (const id of pending) {
    if (saved.has(id)) pending.delete(id);
    else if (!current.has(id)) {
      pending.delete(id);
      abandoned.push(id);
    }
  }
  return abandoned;
};
