export const LOCAL_PROCESS_CLOSE_DELAY_MS = 1000;

export type LocalProcessPhase = { running: boolean; answering: boolean };

export type LocalProcessDisclosure = {
  open: boolean;
  /** The user collapsed the panel while thinking was still the only output. */
  dismissed: boolean;
  /** The user reopened the panel after the answer had already started. */
  heldOpen: boolean;
};

export const initialLocalProcessDisclosure = (phase: LocalProcessPhase): LocalProcessDisclosure => ({
  open: phase.running && !phase.answering,
  dismissed: false,
  heldOpen: false,
});

export function syncLocalProcessDisclosure(
  current: LocalProcessDisclosure,
  phase: LocalProcessPhase,
): LocalProcessDisclosure | { closeSoon: true } {
  if (current.heldOpen) return current;
  if (phase.running && !phase.answering) {
    if (current.dismissed) return { ...current, open: false };
    return { open: true, dismissed: false, heldOpen: false };
  }
  if (!current.open) return { ...current, open: false };
  return { closeSoon: true };
}

export function toggleLocalProcessDisclosure(
  current: LocalProcessDisclosure,
  open: boolean,
  phase: LocalProcessPhase,
): LocalProcessDisclosure {
  if (open) {
    return { open: true, dismissed: false, heldOpen: !phase.running || phase.answering };
  }
  return { open: false, dismissed: phase.running && !phase.answering, heldOpen: false };
}
