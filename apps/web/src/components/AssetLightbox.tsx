import Lightbox, { type LightboxExternalProps } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

export const AssetLightbox = (props: LightboxExternalProps) => <Lightbox {...props} plugins={[Zoom, Thumbnails]} />;
