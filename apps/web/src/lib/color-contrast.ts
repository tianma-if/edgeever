const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: string) => HEX_COLOR_PATTERN.test(value);

export const relativeLuminance = (hex: string) => {
  if (!isHexColor(hex)) {
    throw new Error(`Expected a six-digit hex color, received: ${hex}`);
  }
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  return channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
};

export const contrastRatio = (foreground: string, background: string) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};
