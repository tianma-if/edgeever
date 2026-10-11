import { MathfieldElement } from "mathlive";
import "mathlive/fonts.css";

// Vite packages the fonts locally. Disable MathLive's automatic directory/CDN
// loading and optional key sounds so the editor also works in desktop/offline use.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

export { MathfieldElement, convertLatexToMarkup } from "mathlive";
