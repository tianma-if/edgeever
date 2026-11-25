import { parsePosterDocument, POSTER_DESIGN_TEMPLATES } from '@edgeever/shared';
import type { DatabaseAdapter } from './storage-contract';
import { AppError } from './app-error';
import { createId, isoNow } from './entity-utils';
import { getMemoDetail } from './memo-service';

export type PosterRenderJobRow = {
  id: string; workspace_id: string; memo_id: string; expected_revision: number;
  template_id: string | null; status: 'pending' | 'rendering' | 'completed' | 'failed';
  claim_token: string | null; expires_at: string; result_revision: number | null;
  error_code: string | null; created_at: string;
};
export const posterRenderJob = (row: PosterRenderJobRow) => ({
  id: row.id, memoId: row.memo_id, expectedRevision: row.expected_revision,
  templateId: row.template_id, status: (row.status === 'pending' || row.status === 'rendering') && row.expires_at <= isoNow() ? 'failed' : row.status,
  resultRevision: row.result_revision, errorCode: row.error_code ?? (row.expires_at <= isoNow() && ['pending', 'rendering'].includes(row.status) ? 'client_timeout' : null),
  expiresAt: row.expires_at, renderer: 'client',
});
export const readPosterRenderJob = (db: DatabaseAdapter, workspace: string, id: string) =>
  db.prepare('SELECT * FROM poster_render_jobs WHERE workspace_id = ? AND id = ?').bind(workspace, id).first<PosterRenderJobRow>();

export type PosterRenderRequest = {
  workspace: string;
  memoId: string;
  revision: number;
  templateId?: string;
};

export async function requestPosterRender(
  db: DatabaseAdapter,
  { workspace, memoId, revision, templateId }: PosterRenderRequest,
  notifyPending?: () => void,
) {
  if (!Number.isInteger(revision) || revision < 0) throw new AppError('invalid_params', 'expectedRevision is required', 400);
  if (templateId && !POSTER_DESIGN_TEMPLATES.some(template => template.available && template.id === templateId)) throw new AppError('invalid_params', 'Unknown design template; read get_poster_capabilities', 400);
  const memo = await getMemoDetail(db, workspace, memoId);
  if (!memo) throw new AppError('not_found', 'Memo not found', 404);
  const poster = parsePosterDocument(memo.contentMarkdown);
  if (!poster) throw new AppError('not_poster', 'Memo is not a poster', 400);
  if (memo.revision !== revision) throw new AppError('revision_conflict', 'Read the poster again', 409);
  if (templateId && poster.elements.some(element => element.locked)) throw new AppError('invalid_params', 'Cannot replace a template with locked elements', 400);
  const now = isoNow();
  await db.prepare("UPDATE poster_render_jobs SET status = 'failed', error_code = 'client_timeout' WHERE workspace_id = ? AND status IN ('pending','rendering') AND expires_at <= ?").bind(workspace, now).run();
  await db.prepare("DELETE FROM poster_render_jobs WHERE workspace_id = ? AND status IN ('completed','failed') AND created_at < ?").bind(workspace, new Date(Date.now() - 7 * 86400000).toISOString()).run();
  const output = (row: PosterRenderJobRow) => {
    if (row.expected_revision !== revision || row.template_id !== (templateId ?? null)) throw new AppError('render_busy', 'Another render is pending for this poster', 409);
    const job = posterRenderJob(row);
    if (job.status === 'pending') notifyPending?.();
    return { ...job, message: 'Client render task: pending waits for an online desktop/Web workspace; rendering is in progress. Poll get_poster_render_job; only completed means rendered. Then read get_poster_preview.' };
  };
  const existing = await db.prepare("SELECT * FROM poster_render_jobs WHERE workspace_id = ? AND memo_id = ? AND status IN ('pending','rendering')").bind(workspace, memoId).first<PosterRenderJobRow>();
  if (existing) return output(existing);
  const count = await db.prepare("SELECT COUNT(*) AS n FROM poster_render_jobs WHERE workspace_id = ? AND status IN ('pending','rendering')").bind(workspace).first<{n: number}>();
  if ((count?.n ?? 0) >= 20) throw new AppError('render_queue_full', 'Too many pending renders', 429);
  const id = createId('prj');
  await db.prepare("INSERT OR IGNORE INTO poster_render_jobs(id, workspace_id, memo_id, expected_revision, template_id, status, expires_at, created_at) SELECT ?, ?, ?, ?, ?, 'pending', ?, ? WHERE (SELECT COUNT(*) FROM poster_render_jobs WHERE workspace_id = ? AND status IN ('pending','rendering')) < 20")
    .bind(id, workspace, memoId, revision, templateId ?? null, new Date(Date.now() + 10 * 60000).toISOString(), now, workspace).run();
  const row = await db.prepare("SELECT * FROM poster_render_jobs WHERE workspace_id = ? AND memo_id = ? AND status IN ('pending','rendering')").bind(workspace, memoId).first<PosterRenderJobRow>();
  if (!row) throw new AppError('render_queue_full', 'Too many pending renders', 429);
  return output(row);
}

export const hasPendingPosterRender = async (db: DatabaseAdapter, workspace: string) =>
  Boolean(await db.prepare("SELECT 1 FROM poster_render_jobs WHERE workspace_id = ? AND status = 'pending' AND expires_at > ? LIMIT 1")
    .bind(workspace, isoNow()).first());

export async function claimPosterRender(db: DatabaseAdapter, workspace: string) {
  const token = createId('claim');
  const now = isoNow();
  return db.prepare(`UPDATE poster_render_jobs SET status = 'rendering', claim_token = ?, expires_at = ?
    WHERE id = (SELECT id FROM poster_render_jobs WHERE workspace_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at LIMIT 1)
    AND status = 'pending' RETURNING *`).bind(token, new Date(Date.now() + 2 * 60000).toISOString(), workspace, now).first<PosterRenderJobRow>();
}
