import { parsePosterDocument, type PosterDocument } from '@edgeever/shared';
import { api, ApiRequestError, openPosterRenderEvents } from './api';
import { subscribeToPosterRenders } from './poster-render-subscription';

export async function applyClientPosterTemplate(document: PosterDocument, templateId: string, zh: boolean) {
  const { applyPosterDesign } = await import('./poster-design/templates');
  return applyPosterDesign(document, templateId, zh);
}

// One task at a time per workspace window. Database claims serialize all windows
// and devices; no editor mount or service-side Fabric runtime is required.
type RenderClient = Pick<typeof api, 'claimPosterRender' | 'completePosterRender' | 'getMemo' | 'getResourceBlob' | 'uploadMemoResource' | 'deleteResource'>;
export function startPosterClientRenderer(onSaved: () => Promise<void>, zh: boolean, client: RenderClient = api) {
  let stopped = false;

  const drain = async () => {
    while (!stopped && navigator.onLine !== false) {
      const { job } = await client.claimPosterRender();
      if (!job) return;
      let previewId: string | undefined;
      try {
        const { memo } = await client.getMemo(job.memoId);
        if (memo.revision !== job.expectedRevision) throw new ApiRequestError('Poster changed', 409, 'revision_conflict');
        const source = parsePosterDocument(memo.contentMarkdown);
        if (!source) throw new Error('Not a poster');
        if (stopped) throw new Error('Workspace closed');
        const document = job.templateId ? await applyClientPosterTemplate(source, job.templateId, zh) : source;
        const { renderPosterBlob } = await import('./poster-canvas');
        const preview = await renderPosterBlob(document, id => client.getResourceBlob(`/api/v1/resources/${encodeURIComponent(id)}/blob`), 'png', false, Math.min(1, 1600 / Math.max(document.width, document.height)));
        if (preview.size > 4 * 1024 * 1024) throw new Error('Preview exceeds 4 MiB');
        if (stopped || Date.now() >= Date.parse(job.expiresAt)) throw new Error('Render lease expired');
        const { resource } = await client.uploadMemoResource(memo.id, new File([preview], 'poster-preview.png', { type: 'image/png' }));
        previewId = resource.id;
        await client.completePosterRender(job.id, { claimToken: job.claimToken, document: { ...document, previewResourceId: previewId } });
        previewId = undefined;
        await onSaved();
      } catch (error) {
        // A lost completion response may follow a successful commit. Keep any
        // attachment referenced by the latest source before attempting cleanup.
        if (previewId) {
          const latest = await client.getMemo(job.memoId).catch(() => null);
          if (latest && parsePosterDocument(latest.memo.contentMarkdown)?.previewResourceId !== previewId) await client.deleteResource(previewId).catch(() => undefined);
        }
        await client.completePosterRender(job.id, { claimToken: job.claimToken, errorCode: error instanceof ApiRequestError && error.status === 409 ? 'revision_conflict' : 'render_failed' }).catch(() => undefined);
      }
    }
  };
  const unsubscribe = subscribeToPosterRenders(openPosterRenderEvents, drain);
  return () => {
    stopped = true;
    unsubscribe();
  };
}
