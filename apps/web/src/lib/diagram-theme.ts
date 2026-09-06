import type { DiagramTheme } from "@edgeever/shared";

export type DiagramAppearance = "light" | "dark";

export type DiagramPalette = {
  topicFill: string;
  topicText: string;
  nodeFill: string;
  nodeText: string;
  nodeStroke: string;
  topicStroke: string;
  mindMapEdge: string;
  flowEdge: string;
  canvas: string;
  grid: string;
  gridStrong: string;
};

const BRAND_GREEN = "#16A06E";

export const DIAGRAM_THEME_PALETTES: Record<DiagramTheme, Record<DiagramAppearance, DiagramPalette>> = {
  brand: {
    light: {
      topicFill: BRAND_GREEN,
      topicText: "#FFFFFF",
      nodeFill: "#F0F8F4",
      nodeText: "#173B2E",
      nodeStroke: "#B8DFD0",
      topicStroke: "#12845B",
      mindMapEdge: "#55B891",
      flowEdge: "#408A6D",
      canvas: "#F8FAF9",
      grid: "#E6EEE9",
      gridStrong: "#CFDDD5",
    },
    dark: {
      topicFill: BRAND_GREEN,
      topicText: "#F4FFF9",
      nodeFill: "#18211D",
      nodeText: "#E8F2ED",
      nodeStroke: "#3B5248",
      topicStroke: "#58CDA4",
      mindMapEdge: "#4DB58B",
      flowEdge: "#72B99B",
      canvas: "#101311",
      grid: "#1D2722",
      gridStrong: "#2B3A33",
    },
  },
  ocean: {
    light: {
      topicFill: "#DEF1E9",
      topicText: "#0F4432",
      nodeFill: "#FFFEFA",
      nodeText: "#26352E",
      nodeStroke: "#D5E3DB",
      topicStroke: BRAND_GREEN,
      mindMapEdge: "#8ACCB2",
      flowEdge: "#6B9281",
      canvas: "#FBFCFA",
      grid: "#EBF0EC",
      gridStrong: "#D9E3DC",
    },
    dark: {
      topicFill: "#244D3D",
      topicText: "#DFF7ED",
      nodeFill: "#17201C",
      nodeText: "#E6F0EB",
      nodeStroke: "#3B554A",
      topicStroke: "#65C9A4",
      mindMapEdge: "#55B992",
      flowEdge: "#77AD97",
      canvas: "#111713",
      grid: "#202A25",
      gridStrong: "#304039",
    },
  },
  ink: {
    light: {
      topicFill: BRAND_GREEN,
      topicText: "#F5FBF8",
      nodeFill: "#19261F",
      nodeText: "#E5EEE9",
      nodeStroke: "#3C594A",
      topicStroke: "#68D6B0",
      mindMapEdge: "#58BA94",
      flowEdge: "#68A78D",
      canvas: "#101512",
      grid: "#202B25",
      gridStrong: "#304038",
    },
    dark: {
      topicFill: BRAND_GREEN,
      topicText: "#F5FBF8",
      nodeFill: "#151D19",
      nodeText: "#E7F0EB",
      nodeStroke: "#3C594A",
      topicStroke: "#68D6B0",
      mindMapEdge: "#58BA94",
      flowEdge: "#72B296",
      canvas: "#0B0F0D",
      grid: "#19211D",
      gridStrong: "#29362F",
    },
  },
};

export const resolveDiagramPalette = (theme: DiagramTheme, appearance: DiagramAppearance) =>
  DIAGRAM_THEME_PALETTES[theme][appearance];
