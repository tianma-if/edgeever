# Copying diagrams to publishing editors

“Copy as Rich Text” renders Mermaid diagrams to images and automatically uploads
them to the selected image host before writing the clipboard. Built-in storage,
PicGo/PicList, and CloudFlare ImgBed use the same publishing flow. Original notes
and their attachments are not modified.

Built-in storage creates a separate publication copy. Its random public URL
requires no EdgeEver login, so a publishing platform can import it. Existing
private resource URLs retain their authentication requirements. Identical images
in the same workspace reuse the publication URL. Publication copies remain
available until revoked; they are separate from note archive exports.

The instance must be reachable from the Internet. Localhost and private network
addresses cannot be fetched by Zhihu. A locally running client can use an external
image host instead. Address checks cannot detect every DNS, firewall, authentication
gateway, or hotlink restriction; verify the destination editor's actual import.
Rendering, upload, or host cancellation failures stop copying and display an error.

For instance administrators: migration `0094_publish_images.sql` adds the publication
index. Deploy the API and apply migrations before using the updated client.
`POST /api/v1/publish-images` accepts authenticated user uploads of PNG/JPEG images
up to 10 MiB. `GET /api/public/publish-images/:token` serves only the corresponding
publication copy. `DELETE /api/v1/publish-images/:token` revokes a URL and deletes its
copy, within the authenticated user's workspace. Revocation cannot delete copies
already imported by a publishing platform.
