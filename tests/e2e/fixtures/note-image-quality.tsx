import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ShareNoteImageDialog } from '../../../apps/web/src/components/dialogs/ShareNoteImageDialog';
import { createNoteImage, generateCardCss, buildNoteImageCardMarkup } from '../../../apps/web/src/lib/note-image-export';
import { prepareNoteBodyHtmlForExport } from '../../../apps/web/src/lib/note-html-export';
import { planWebNoteImageRender } from '../../../apps/web/src/lib/note-image-rendering';
import { copyImageBlobToClipboard } from '../../../apps/web/src/lib/clipboard';
import { prepareNoteImageAssets } from '@edgeever/shared/note-image-fonts';
import { noteImageAssetUrls } from '@edgeever/shared/note-image-assets';
import { NOTE_IMAGE_THEME_OPTIONS, NOTE_IMAGE_CARD_WIDTH_PIXELS } from '@edgeever/shared/note-image-card';
import { prepareNoteImageContent } from '@edgeever/shared/note-image-card';
import { complexBodyHtml, complexDocument } from './note-image-content';
import '../../../apps/web/src/i18n';
import '../../../apps/web/src/styles/globals.css';

const paragraph = '记录思想，也保留文字的细节。清晰的图片应该完整呈现每一行中文、标点和 English text，不因主题切换而丢失原来的颜色。';
const chart = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><rect width="600" height="180" fill="#eee"/><path d="M20 140H580M20 20V140M40 120L160 80L280 100L400 40L560 20" fill="none" stroke="#07130b" stroke-width="3"/></svg>');
const rich = `<h2>文字、表格与图片</h2><p><strong>加粗文字</strong> 与 <em>斜体 text</em>，日本語，Zażółć gęślą jaźń。</p><table><tbody><tr><th>项目</th><th>内容</th></tr><tr><td>排版</td><td>清晰的文字与完整的表格</td></tr></tbody></table><pre><code>const note = { title: "Keep writing", ready: true };</code></pre><img src="${chart}"><ul><li>条目一</li><li>条目二</li></ul>`;
const base = { title: '清晰的文字，真实的颜色', notebook: '质量检查', tags: ['quality'], updatedAt: '2026/10/16', author: '天马', showAuthor: true, showTitle: true, branding: true, styles: '', fallbackTitle: 'Note' };
const sources = {
  short: { ...base, bodyHtml: `<p>${paragraph}</p>${rich}` },
  long: { ...base, bodyHtml: `<p>${paragraph}</p>`.repeat(85) + rich },
  complex: { ...base, bodyHtml: complexBodyHtml },
};

const renderCase = async (theme: typeof NOTE_IMAGE_THEME_OPTIONS[number], cardWidth: 'compact' | 'standard' | 'wide', format: 'png' | 'jpeg', length: 'short' | 'long' | 'complex') => {
  const options = { ...sources[length], theme, cardWidth, format };
  const prepared = await prepareNoteBodyHtmlForExport(options.bodyHtml);
  const normalized = document.createElement('div');
  normalized.innerHTML = prepared.bodyHtml;
  prepareNoteImageContent(normalized);
  const assets = await prepareNoteImageAssets({ theme, text: Object.values(options).join(' '), urls: noteImageAssetUrls });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${assets.css}${generateCardCss({ theme, fontStyle: 'auto', fontSize: 'lg', cardWidth })}</style>${buildNoteImageCardMarkup({ ...options, bodyHtml: normalized.innerHTML, showBranding: true })}`;
  document.body.append(host);
  try {
    // Trigger layout before awaiting fonts; shadow-root font faces are lazy.
    root.querySelector<HTMLElement>('.edgeever-image-wrapper')!.getBoundingClientRect();
    await document.fonts.ready;
    await Promise.all([...root.querySelectorAll<HTMLImageElement>("img")].map(image => image.decode()));
    const wrapper = root.querySelector<HTMLElement>('.edgeever-image-wrapper')!;
    const logo = root.querySelector<SVGSVGElement>('.edgeever-brand-logo')!;
    const wrapperBox = wrapper.getBoundingClientRect();
    const logoBox = logo.getBoundingClientRect();
    let opacity = 1;
    let effects = false;
    for (let element: Element | null = logo; element; element = element.parentElement) {
      const css = getComputedStyle(element);
      opacity *= Number(css.opacity);
      effects ||= css.filter !== 'none';
    }
    const body = root.querySelector<HTMLElement>('.edgeever-card-body')!;
    const bodyBox = body.getBoundingClientRect();
    const title = root.querySelector<HTMLElement>('.edgeever-card-title')!;
    const titleSize = parseFloat(getComputedStyle(title).fontSize);
    const bodySize = parseFloat(getComputedStyle(body).fontSize);
    const headingSizes = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(heading => parseFloat(getComputedStyle(heading).fontSize));
    const secondParagraph = body.querySelector<HTMLElement>(':scope > p + p');
    const paragraphGap = secondParagraph ? secondParagraph.getBoundingClientRect().top - secondParagraph.previousElementSibling!.getBoundingClientRect().bottom : null;
    const overflow = [...body.querySelectorAll<HTMLElement>('*')].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > bodyBox.right + 1 || box.left < bodyBox.left - 1);
    }).map(element => element.tagName);
    const integrity = length === 'complex' ? {
      stackedValues: body.querySelectorAll('.edgeever-table-value').length,
      mergedCells: body.querySelectorAll('[colspan="2"]').length,
      complete: ['END_TABLE', 'END_CODE', 'END_LIST', 'END_QUOTE', 'END_CONTENT'].every(marker => body.textContent?.includes(marker)),
      imageRatios: [...body.querySelectorAll('img')].map(img => {
        const box = img.getBoundingClientRect();
        return (box.width / box.height) / (img.naturalWidth / img.naturalHeight);
      }),
    } : null;
    const image = await createNoteImage(options);
    // Added paragraph spacing can take long notes past the existing pixel budget.
    const layoutWidth = NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth];
    const layoutHeight = Math.ceil(wrapperBox.height);
    const { pixelRatio } = planWebNoteImageRender(layoutWidth, layoutHeight, 65_535);
    const expectedWidth = Math.floor(layoutWidth * pixelRatio);
    const expectedHeight = Math.floor(layoutHeight * pixelRatio);
    const sx = image.width / wrapperBox.width;
    const x = Math.max(0, Math.floor((logoBox.left - wrapperBox.left) * sx));
    const width = Math.min(image.width - x, Math.ceil(logoBox.width * sx));
    // html-to-image rounds font sizes when cloning, so preceding text can shift
    // the exported logo vertically. Locate its green tile in the actual pixels.
    const bitmap = await createImageBitmap(image.blob, x, 0, width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0; let dark = 0;
    let firstTileRow = canvas.height; let lastTileRow = -1;
    // No other fixture content uses this green. Restrict dark-pixel checks to
    // the tile's actual rows, excluding footer text and decorative borders.
    const tolerance = format === 'png' ? 0 : 12;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - 36) <= tolerance && Math.abs(pixels[i + 1] - 207) <= tolerance && Math.abs(pixels[i + 2] - 131) <= tolerance) {
        green++;
        const row = Math.floor(i / 4 / canvas.width);
        firstTileRow = Math.min(firstTileRow, row); lastTileRow = Math.max(lastTileRow, row);
      }
    }
    for (let i = firstTileRow * canvas.width * 4; i < (lastTileRow + 1) * canvas.width * 4; i += 4) {
      if (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2] < 70) dark++;
    }
    bitmap.close(); canvas.width = canvas.height = 0;
    return { theme, cardWidth, format, length, width: image.width, height: image.height, expectedWidth, expectedHeight, density: image.width / Math.min(654, layoutWidth), green, dark, tile: logo.querySelector("rect")!.getAttribute("fill"), mark: logo.querySelector("path")!.getAttribute("fill"), opacity, effects, overflow, bytes: image.blob.size, titleSize, bodySize, headingSizes, paragraphGap, integrity };
  } finally { host.remove(); }
};

const App = () => {
  const [source, setSource] = useState(sources.long);
  const [open, setOpen] = useState(!new URLSearchParams(location.search).has("matrix"));
  const [mounted, setMounted] = useState(true);
  Object.assign(window, { imageQuality: { renderCase, sources, complexDocument, createNoteImage, copyImageBlobToClipboard, setSource, setOpen, setMounted, themes: NOTE_IMAGE_THEME_OPTIONS } });
  return mounted ? <ShareNoteImageDialog open={open} onOpenChange={setOpen} source={source} /> : null;
};
// The fixture may be loaded through both canonical and /@fs Vite URLs.
const scope = window as unknown as { qualityRoot?: ReturnType<typeof createRoot> };
const root = scope.qualityRoot ?? createRoot(document.getElementById('root')!);
scope.qualityRoot = root;
root.render(<App />);
