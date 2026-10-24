# Individual image alignment

Select a standalone image in the rich text editor to choose **Left**, **Center**, or **Right**. Alignment belongs to that image and works with its size setting. The selected image's controls occupy a wrapping row below the picture so controls remain usable on smaller images. Dragging to resize retains the chosen alignment without jumping at the start of the drag.

Existing images retain their default layout until an alignment is chosen. Galleries continue to use their own layout controls. Explicitly aligned images remain separate during Markdown import, instead of becoming a gallery merely because they are adjacent.

Alignment is saved in rich text JSON and exported as an HTML image tag in Markdown, including its percentage width and portable alignment styles. The shared codec supports the tags without a DOM, including inside expandable details. Shared and native image schemas retain the attribute, and native figure renderers apply explicit alignment. Native alignment-picker controls are outside this change, and native-device testing has not been performed.
