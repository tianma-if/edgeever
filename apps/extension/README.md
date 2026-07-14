# EdgeEver Web Clipper

Chrome/Edge Manifest V3 extension for saving the current webpage or selected text to a user's self-hosted EdgeEver instance.

## Current MVP

- Configure an EdgeEver instance URL and API Token.
- Test the connection and select a default notebook.
- Click the extension action to capture the selected content, or extract the article body with Mozilla Readability when there is no selection.
- Convert the extracted article HTML into Markdown with Turndown before uploading it.
- Create a searchable EdgeEver memo with the source URL and a `web-clip` tag.

The extension does not use a central relay service. The page content is sent directly to the EdgeEver instance configured by the user.

## Development

From the repository root:

```sh
bun run build:extension
```

Then open `apps/extension/dist` from `chrome://extensions` or `edge://extensions` with Developer mode enabled and choose **Load unpacked**.

The next planned step is preserving a single-file HTML archive in R2 while keeping extracted text in the memo for search.
