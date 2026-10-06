# EdgeEver Web Clipper

Chrome, Edge, and Firefox Manifest V3 extension for saving the current webpage, selected text, or a right-clicked image to a user's self-hosted EdgeEver instance.

## Current MVP

- Configure an EdgeEver instance URL and API Token.
- Test the connection and select a default notebook.
- Click the extension action to capture the selected content, or extract the article body with Mozilla Readability when there is no selection.
- Convert the extracted article HTML into Markdown with Turndown before uploading it.
- Right-click an image and choose **Save image to EdgeEver**. The image file is uploaded into a new note in the default notebook, with the source page linked underneath. An image saved from Google Search records “Google Search” and the search keyword instead of the results URL.
- Select text on a page, right-click, and choose **Save selection to EdgeEver**. That passage is saved as a new note in the default notebook, with the source page linked underneath. The rest of the page is not included.
- On X, right-click the post text and choose **Save this post to EdgeEver**. The post text, author, time, and photos already shown in that post are saved into one note. Text folded behind Show more is expanded first, so a long post is saved in full. Right-clicking a photo saves that image instead, so the command stays on the top-level menu. A single-post page can be saved immediately. On a timeline, the extension asks once for access to X so it can remember the post under the pointer.
- On Xiaohongshu, right-click the note text and choose **Save Xiaohongshu note to EdgeEver**. The title, text, author, time, location, and photos go into one note. Comments are left out. Right-clicking a photo saves that image instead. An open note can be saved immediately. On the feed, the extension asks once for access to Xiaohongshu so it can remember the note under the pointer; open that note before saving if its full text is not on the page.
- On Zhihu, right-click the answer or article text and choose **Save Zhihu content to EdgeEver**. The title, author, full text, and photos go into one note. Comments are left out. Right-clicking a photo saves that image instead. An open answer or article can be saved immediately. On the home feed or a question page, the extension remembers the item under the pointer; if that listener is not running yet, right-click the same text once more.
- On Reddit, right-click a post or its title link and choose **Save Reddit post to EdgeEver**. The selected post becomes one note with its title, author, community, post text, source link, linked page, and available images. Comments are left out. The extension reads the selected post through Reddit's JSON response when available and falls back to its visible content. If the pointer listener is unavailable on a feed, right-click the same post once more.
- On a GitHub repository page or code tree, right-click the page background, the description, or the README text and choose **Save this repository to EdgeEver**. The note keeps the repository address, the About text, and the homepage, language, license, and topics when the page shows them. An empty About falls back to the README's first paragraph. Issue, discussion, and single-file pages are left unsaved. The toolbar action uses the same card on those repository pages. Right-clicking a link or an image keeps the existing selection and image commands, so this one stays on the top-level menu.
- When the page cannot hand over the image bytes, the extension asks once for access to that image's site. After that, later images from the same site save directly.
- Create a searchable EdgeEver memo with the source URL and a `web-clip` tag.

The extension does not use a central relay service. The page content is sent directly to the EdgeEver instance configured by the user.

## Localization

The extension uses the cross-browser `chrome.i18n` compatibility namespace. English is the fallback locale, and Simplified Chinese is available for browsers whose UI language is Chinese.

User-visible strings live in `public/_locales/<locale>/messages.json`. Add or update every supported locale when changing interface copy. Chrome Web Store listing translations are maintained separately in the developer dashboard; ready-to-paste English and Simplified Chinese copy is available in `STORE_LISTING.md`.

## Development

### Chromium

From the repository root:

```sh
bun run build:extension
```

Then open `apps/extension/dist` from `chrome://extensions` or `edge://extensions` with Developer mode enabled and choose **Load unpacked**.

### Firefox

Firefox uses the same application code with a Firefox-specific generated manifest:

```sh
bun run build:extension:firefox
bun run lint:extension:firefox
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `apps/extension/dist-firefox/manifest.json`.

To create the unsigned AMO submission archive after building and linting:

```sh
bun run package:extension:firefox
```

The archive is written to `apps/extension/web-ext-artifacts`. Firefox requires AMO signing for normal installation. The manifest supports Firefox Desktop 140 or later and Firefox for Android 142 or later so Mozilla's built-in data-transmission consent UI is available.

## Store submission

Chrome and Edge share one Chrome Web Store item. Firefox is submitted separately. From the repository root, the official workflow **Submit Web Clipper** builds and submits both. See [Web Clipper store submission](../../docs/extension-store.md). Increase the `version` in `package.json` before submitting; an uploaded version cannot be replaced.

## Firefox data disclosure

The Firefox package declares the data types required by its user-triggered clipping function:

- `authenticationInfo`: the API token sent directly to the user's EdgeEver instance.
- `browsingActivity`: the URL of the page the user chooses to clip.
- `websiteContent`: the selected text, extracted article content, or image the user chooses to clip.

No data is sent to an EdgeEver-operated relay, analytics service, or advertising service.

The next planned step is preserving a single-file HTML archive in R2 while keeping extracted text in the memo for search.
