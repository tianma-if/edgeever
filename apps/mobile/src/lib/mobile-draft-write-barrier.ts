export type MobileDraftWriteBarrier = {
  blockAndDrain: () => Promise<void>;
  enqueue: (write: () => Promise<void>) => Promise<boolean>;
  unblock: () => void;
};

/**
 * Serializes draft writes and lets a successful submit stop late writes before
 * the persisted draft is cleared. A blocked queued write resolves as `false`.
 */
export const createMobileDraftWriteBarrier = (): MobileDraftWriteBarrier => {
  let blocked = false;
  let tail = Promise.resolve();

  return {
    enqueue(write) {
      const result = tail.then(async () => {
        if (blocked) {
          return false;
        }
        await write();
        return true;
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    async blockAndDrain() {
      blocked = true;
      await tail;
    },
    unblock() {
      blocked = false;
    },
  };
};
