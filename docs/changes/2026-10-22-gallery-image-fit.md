# Gallery image fitting

Each image gallery now offers **Fit width** and **Fit height** beside its column controls. Fit width keeps the previous cropped gallery appearance. Fit height shows each entire image inside an evenly sized tile, including the top and bottom of portrait images; unused space remains beside or above the image. The choice applies to that gallery only and supports undo/redo.

The gallery stores `fit: "width" | "height"` in its rich document. Missing or unsupported values use width fitting. HTML includes `data-image-gallery-fit`, used by editor, public sharing, HTML export, and print styles. The shared Android/iOS gallery toolbar also offers the two choices. Image-card exports already show complete images and retain that behavior.

Height-fit galleries use `<!-- edgeever:image-gallery fit=height layout=… -->` and `<!-- /edgeever:image-gallery -->` around ordinary Markdown images so editing unrelated Markdown preserves both fit and column layout. Other Markdown readers can still show the images. If text is inserted inside the markers, EdgeEver preserves the edited content and splits the gallery. Default width-fit galleries retain their existing ordinary-image Markdown projection.

This adds no database migration or dependency. Revert the feature commit to roll back the implementation; older clients may ignore the fit attribute and show their previous layout, and older Markdown parsers do not preserve the comments as gallery settings. Verify Web layout, saving/reopening, Markdown edits, read-only views, export, and narrow screens. Android USB-device and iOS-device validation remain required before claiming native visual parity.
