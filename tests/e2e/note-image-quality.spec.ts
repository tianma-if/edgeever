import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NOTE_IMAGE_THEME_OPTIONS } from '../../packages/shared/src/note-image-card';

type CaseResult = {
  theme: string; width: number; height: number; expectedWidth: number; expectedHeight: number; density: number;
  green: number; dark: number; tile: string; mark: string; opacity: number; effects: boolean; overflow: string[];
  titleSize: number; bodySize: number; headingSizes: number[]; paragraphGap: number | null;
  integrity: { stackedValues: number; mergedCells: number; complete: boolean; imageRatios: number[] } | null;
};
type QualityApi = {
  renderCase: (theme: string, width: string, format: string, length: string) => Promise<CaseResult>;
  sources: { short: { title: string; bodyHtml: string } };
  setSource: (source: QualityApi['sources']['short']) => void;
  setOpen: (open: boolean) => void;
  setMounted: (mounted: boolean) => void;
};
type QualityWindow = Window & { imageQuality: QualityApi; copiedImage?: { width: number; height: number; hash: string } };
const labels = { glass: '透明', quote: '金句', book: '书摘', memo: '备忘录', bento: '便当', 'black-sun': '黑日', frame: '框界', handwritten: '手写', code: '代码' };
const preamble = `<script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script>`;
const fixture = fileURLToPath(new URL('./fixtures/note-image-quality.tsx', import.meta.url));

test.use({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });

const boot = async (page: Page, matrix = false) => {
  await page.route('**/note-image-quality-fixture*', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><meta charset="utf-8"><div id="root"></div>${preamble}<script type="module" src="/@fs${fixture}"></script>`,
  }));
  await page.goto(`/note-image-quality-fixture${matrix ? '?matrix=1' : ''}`);
  await page.waitForFunction(() => Boolean((window as QualityWindow).imageQuality));
};

for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
  test(`${theme}: all image formats and widths retain sharp text and brand colors`, async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page, true);
    for (const length of ['short', 'long', 'complex']) for (const width of ['compact', 'standard', 'wide']) for (const format of ['png', 'jpeg']) {
      const result = await page.evaluate(({ theme, width, format, length }) =>
        (window as QualityWindow).imageQuality.renderCase(theme, width, format, length), { theme, width, format, length });
      const label = `${theme}/${length}/${width}/${format}`;
      expect(result.width, label).toBe(result.expectedWidth);
      expect(result.height, label).toBe(result.expectedHeight);
      expect(result.density, label).toBeGreaterThanOrEqual(1.99);
      expect(result.width * result.height, label).toBeLessThanOrEqual(80_000_000);
      expect(result.opacity, label).toBe(1);
      expect(result.effects, label).toBe(false);
      expect(result.tile, label).toBe('#24cf83');
      expect(result.mark, label).toBe('#07130b');
      expect(result.green, label).toBeGreaterThan(50);
      expect(result.dark, label).toBeGreaterThan(4);
      expect(result.overflow, label).toEqual([]);
      expect(result.titleSize, label).toBeGreaterThan(Math.max(result.bodySize, ...result.headingSizes));
      if (length === 'long') expect(result.paragraphGap! / result.bodySize, label).toBeCloseTo(0.7, 1);
      if (length === 'complex') {
        expect(result.integrity!.stackedValues, label).toBe(12);
        expect(result.integrity!.mergedCells, label).toBe(1);
        expect(result.integrity!.complete, label).toBe(true);
        expect(result.integrity!.imageRatios, label).toHaveLength(3);
        for (const ratio of result.integrity!.imageRatios) expect(ratio, label).toBeCloseTo(1, 1);
      }
    }
  });

  test(`${theme}: preview, clipboard payload and downloaded file preserve the same image`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    // CI captures the real ClipboardItem payload without touching the host clipboard.
    // Manual acceptance also exercises the OS clipboard and compares decoded pixels.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async (items: ClipboardItem[]) => {
          const blob = await items[0].getType('image/png');
          const data = await blob.arrayBuffer();
          const header = new DataView(data);
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
          (window as QualityWindow).copiedImage = { width: header.getUint32(16), height: header.getUint32(20), hash };
        },
      } });
    });
    await boot(page);
    const preview = page.getByAltText('笔记分享图片预览');
    await expect(preview).toBeVisible();
    if (theme !== 'glass') {
      const old = await preview.getAttribute('src');
      await page.getByRole('button', { name: labels[theme], exact: true }).click();
      await expect(preview).not.toHaveAttribute('src', old!);
    }
    for (const format of ['png', 'jpeg']) {
      if (format === 'jpeg') {
        const old = await preview.getAttribute('src');
        await page.getByRole('combobox').click();
        await page.getByRole('option').filter({ hasText: /^JPEG/ }).click();
        await expect(preview).not.toHaveAttribute('src', old!);
      }
      const image = await preview.evaluate(async node => {
        const img = node as HTMLImageElement;
        await img.decode();
        const blob = await (await fetch(img.src)).blob();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
        return { width: img.naturalWidth, height: img.naturalHeight, density: img.naturalWidth / img.getBoundingClientRect().width, hash };
      });
      expect(image.density).toBeGreaterThanOrEqual(1.99);
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载图片', exact: true }).click();
      const download = await downloading;
      const path = testInfo.outputPath(`${theme}.${format === 'png' ? 'png' : 'jpg'}`);
      await download.saveAs(path);
      expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(image.hash);
      await page.getByRole('button', { name: '复制图片', exact: true }).click();
      await expect(page.getByRole('button', { name: '已复制到剪贴板', exact: true })).toBeVisible();
      const copied = await page.evaluate(() => (window as QualityWindow).copiedImage!);
      expect([copied.width, copied.height]).toEqual([image.width, image.height]);
      if (format === 'png') expect(copied.hash).toBe(image.hash);
    }
  });
}

for (const blockedStorage of [false, true]) {
  test(`title preference survives dialog lifecycle${blockedStorage ? ' with blocked storage' : ' and reload'}`, async ({ page }) => {
    if (blockedStorage) await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    });
    await boot(page);
    const shortSource = () => page.evaluate(() => {
      const api = (window as QualityWindow).imageQuality;
      api.setSource(api.sources.short);
    });
    await shortSource();
    const title = page.getByRole('checkbox', { name: '笔记标题', exact: true });
    const preview = page.getByAltText('笔记分享图片预览');
    const hashPreview = async () => {
      await expect(preview).toBeVisible();
      return preview.evaluate(async node => {
        const img = node as HTMLImageElement;
        await img.decode();
        const bytes = await (await fetch(img.src)).arrayBuffer();
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join(',');
      });
    };
    await expect(title).toBeChecked();
    const withTitle = await hashPreview();
    const previousUrl = await preview.getAttribute('src');
    await title.uncheck();
    await expect(preview).not.toHaveAttribute('src', previousUrl!);
    const withoutTitle = await hashPreview();
    expect(withoutTitle).not.toBe(withTitle);

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(title).toHaveCount(0);
    await page.evaluate(() => (window as QualityWindow).imageQuality.setOpen(true));
    await expect(title).not.toBeChecked();
    expect(await hashPreview()).toBe(withoutTitle);

    const oldUrl = await preview.getAttribute('src');
    await page.evaluate(() => {
      const api = (window as QualityWindow).imageQuality;
      api.setSource({ ...api.sources.short, title: '切换到另一篇笔记' });
    });
    await expect(preview).not.toHaveAttribute('src', oldUrl!);
    await expect(title).not.toBeChecked();
    // Changing only the hidden title must leave the actual exported pixels identical.
    expect(await hashPreview()).toBe(withoutTitle);

    await page.evaluate(() => (window as QualityWindow).imageQuality.setMounted(false));
    await expect(title).toHaveCount(0);
    await page.evaluate(() => (window as QualityWindow).imageQuality.setMounted(true));
    await expect(title).not.toBeChecked();
    expect(await hashPreview()).toBe(withoutTitle);

    if (!blockedStorage) {
      await page.reload();
      await page.waitForFunction(() => Boolean((window as QualityWindow).imageQuality));
      await shortSource();
      await expect(title).not.toBeChecked();
      expect(await hashPreview()).toBe(withoutTitle);
      await title.check();
      await expect.poll(hashPreview).toBe(withTitle);
      await page.reload();
      await page.waitForFunction(() => Boolean((window as QualityWindow).imageQuality));
      await shortSource();
      await expect(title).toBeChecked();
      expect(await hashPreview()).toBe(withTitle);
    }
  });
}

for (const blockedStorage of [false, true]) {
  test(`all share preferences survive dialog lifecycle${blockedStorage ? ' with blocked storage' : ' and reload'}`, async ({ page }, testInfo) => {
    if (blockedStorage) await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    });
    await boot(page);
    await page.evaluate(() => {
      const api = (window as QualityWindow).imageQuality;
      api.setSource(api.sources.short);
    });
    const checkboxLabels = ['笔记标题', '笔记本', '标签', '更新时间', '阅读时长与字数', '创作者署名', 'EdgeEver 品牌标识'];
    const chosen = [false, true, true, false, true, true, false];
    const preview = page.getByAltText('笔记分享图片预览');
    const hash = async () => {
      await expect(page.getByRole('button', { name: '下载图片', exact: true })).toBeEnabled();
      return preview.evaluate(async node => {
        const image = node as HTMLImageElement;
        await image.decode();
        const blob = await (await fetch(image.src)).blob();
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      });
    };
    const assertChoices = async (inverted = false) => {
      for (let i = 0; i < chosen.length; i++) {
        await expect(page.getByRole('checkbox', { name: checkboxLabels[i], exact: true })).toBeChecked({ checked: inverted ? !chosen[i] : chosen[i] });
      }
      await expect(page.getByRole('button', { name: inverted ? '默认' : '书摘', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: inverted ? /^跟随主题/ : '文艺衬线' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: inverted ? '舒适' : '标准', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: inverted ? '宽屏 (800px)' : '紧凑 (560px)', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('combobox')).toContainText(inverted ? 'PNG' : 'JPEG');
      if (!inverted) await expect(page.getByPlaceholder('输入署名或昵称')).toHaveValue('持久保存的署名');
    };
    await page.getByRole('button', { name: '书摘', exact: true }).click();
    await page.getByRole('button', { name: '文艺衬线', exact: true }).click();
    await page.getByRole('button', { name: '标准', exact: true }).click();
    await page.getByRole('button', { name: '紧凑 (560px)', exact: true }).click();
    for (let i = 0; i < chosen.length; i++) {
      await page.getByRole('checkbox', { name: checkboxLabels[i], exact: true }).setChecked(chosen[i]);
    }
    await page.getByPlaceholder('输入署名或昵称').fill('持久保存的署名');
    await page.getByRole('combobox').click();
    await page.getByRole('option').filter({ hasText: /^JPEG/ }).click();
    await assertChoices();
    const expectedHash = await hash();

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await page.evaluate(() => (window as QualityWindow).imageQuality.setOpen(true));
    await assertChoices();
    expect(await hash()).toBe(expectedHash);
    await page.evaluate(() => {
      const api = (window as QualityWindow).imageQuality;
      api.setSource({ ...api.sources.short, title: '另一篇笔记' });
    });
    await assertChoices();
    expect(await hash()).toBe(expectedHash);
    await page.evaluate(() => (window as QualityWindow).imageQuality.setMounted(false));
    await expect(preview).toHaveCount(0);
    await page.evaluate(() => (window as QualityWindow).imageQuality.setMounted(true));
    await assertChoices();
    expect(await hash()).toBe(expectedHash);
    if (!blockedStorage) {
      await page.reload();
      await page.waitForFunction(() => Boolean((window as QualityWindow).imageQuality));
      await page.evaluate(() => {
        const api = (window as QualityWindow).imageQuality;
        api.setSource(api.sources.short);
      });
      await assertChoices();
      expect(await hash()).toBe(expectedHash);
    }
    // Download must use the remembered format and the exact preview image.
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载图片', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.jpe?g$/);
    const path = testInfo.outputPath('remembered-settings.jpg');
    await download.saveAs(path);
    expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(expectedHash);

    // Save opposite values too: explicit false must override a nonempty signature.
    for (let i = 0; i < chosen.length; i++) {
      await page.getByRole('checkbox', { name: checkboxLabels[i], exact: true }).setChecked(!chosen[i]);
    }
    await page.getByRole('button', { name: '默认', exact: true }).click();
    await page.getByRole('button', { name: /^跟随主题/ }).click();
    await page.getByRole('button', { name: '舒适', exact: true }).click();
    await page.getByRole('button', { name: '宽屏 (800px)', exact: true }).click();
    await page.getByRole('combobox').click();
    await page.getByRole('option').filter({ hasText: /^PNG/ }).click();
    if (!blockedStorage) {
      await page.reload();
      await page.waitForFunction(() => Boolean((window as QualityWindow).imageQuality));
    } else {
      await page.evaluate(() => (window as QualityWindow).imageQuality.setMounted(false));
      await expect(preview).toHaveCount(0);
      await page.evaluate(() => (window as QualityWindow).imageQuality.setMounted(true));
    }
    await assertChoices(true);
    await expect(page.getByPlaceholder('输入署名或昵称')).toHaveCount(0);
    await page.getByRole('checkbox', { name: '创作者署名', exact: true }).check();
    await expect(page.getByPlaceholder('输入署名或昵称')).toHaveValue('持久保存的署名');
  });
}
