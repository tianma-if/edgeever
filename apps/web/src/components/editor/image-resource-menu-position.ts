import { flip, offset, shift, type ComputePositionConfig } from "@floating-ui/react-dom";

/** Keep resource actions outside the image, separate from its in-image controls. */
export const imageResourceMenuPosition: Partial<ComputePositionConfig> = {
  placement: "bottom-end",
  strategy: "fixed",
  middleware: [
    offset(8),
    flip({ padding: 12 }),
    shift({ padding: 12 }),
  ],
};
