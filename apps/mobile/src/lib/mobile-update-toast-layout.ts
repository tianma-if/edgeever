import { MOBILE_UI_METRICS } from "@edgeever/shared/mobile-ui";

const MIN_SCREEN_EDGE_INSET = 12;
const FLOATING_CONTROL_CLEARANCE = 12;

/** Keep the update toast above the bottom navigation and its raised create button. */
export const getMobileUpdateToastBottomOffset = (safeAreaBottom: number): number =>
  Math.max(safeAreaBottom, MIN_SCREEN_EDGE_INSET)
  + MOBILE_UI_METRICS.bottomNavigationHeight
  + MOBILE_UI_METRICS.floatingCreateButtonLift
  + FLOATING_CONTROL_CLEARANCE;
