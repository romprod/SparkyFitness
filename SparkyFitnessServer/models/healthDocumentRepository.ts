import type {
  HealthDocument,
  HealthDocumentFields,
  HealthDocumentMime,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * The rows for the owner's stored originals. The files are on disk; this holds what was checked
 * about each one and which record it is for.
 */
const fail = (message: string, statusCode: number, extra = {}) =>
  Object.assign(new Error(message), {
    statusCode,
    status: statusCode,
    ...extra,
  });

type Row = Record<string, unknown>;

const view = (row: Row): HealthDocument => ({
  id: String(row['id']),
  kind: row['kind'] as HealthDocument['kind'],
  label: (row['label'] as string | null) ?? null,
  document_day: (row['document_day'] as string | null) ?? null,
  original_name: String(row['original_name']),
  mime: row['mime'] as HealthDocumentMime,
  size_bytes: Number(row['size_bytes']),
  body_comp_scan_id: (row['body_comp_scan_id'] as string | null) ?? null,
  metabolic_test_id: (row['metabolic_test_id'] as string | null) ?? null,
  ecg_recording_id: (row['ecg_recording_id'] as string | null) ?? null,
  uploaded_at: new Date(row['created_at'] as string | Date).toISOString(),
});

const COLUMNS = `id, kind, label, document_day::text AS document_day, original_name, mime,
  size_bytes, body_comp_scan_id, metabolic_test_id, ecg_recording_id, created_at`;

/** Every stored original of the owner, newest first. */
export async function listHealthDocuments(
  owner: string,
  authenticatedUserId?: string
): Promise<HealthDocument[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT ${COLUMNS} FROM health_documents WHERE user_id = $1
        ORDER BY created_at DESC, id`,
      [owner]
    );
    return (rows as Row[]).map(view);
  } finally {
    client.release();
  }
}

export interface NewHealthDocument {
  id: string;
  fields: HealthDocumentFields;
  original_name: string;
  mime: HealthDocumentMime;
  size_bytes: number;
  sha256: string;
  file_path: string;
}

/**
 * Records a stored original. The same file is not kept twice: a second upload of identical bytes
 * answers 409 with the one already stored. A scan, test or recording that is not the owner's answers 400.
 */
export async function insertHealthDocument(
  owner: string,
  doc: NewHealthDocument,
  authenticatedUserId?: string
): Promise<HealthDocument> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { fields } = doc;
    if (fields.body_comp_scan_id) {
      const found = await client.query(
        'SELECT 1 FROM body_comp_scans WHERE id = $1 AND user_id = $2',
        [fields.body_comp_scan_id, owner]
      );
      if (!found.rowCount) throw fail('That scan was not found.', 400);
    }
    if (fields.metabolic_test_id) {
      const found = await client.query(
        'SELECT 1 FROM metabolic_tests WHERE id = $1 AND user_id = $2',
        [fields.metabolic_test_id, owner]
      );
      if (!found.rowCount) throw fail('That test was not found.', 400);
    }
    if (fields.ecg_recording_id) {
      const found = await client.query(
        'SELECT 1 FROM ecg_recordings WHERE id = $1 AND user_id = $2',
        [fields.ecg_recording_id, owner]
      );
      if (!found.rowCount) throw fail('That recording was not found.', 400);
    }
    try {
      const { rows } = await client.query(
        `INSERT INTO health_documents
           (id, user_id, kind, label, document_day, original_name, mime, size_bytes, sha256,
            file_path, body_comp_scan_id, metabolic_test_id, ecg_recording_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING ${COLUMNS}`,
        [
          doc.id,
          owner,
          fields.kind,
          fields.label,
          fields.document_day,
          doc.original_name,
          doc.mime,
          doc.size_bytes,
          doc.sha256,
          doc.file_path,
          fields.body_comp_scan_id,
          fields.metabolic_test_id,
          fields.ecg_recording_id,
        ]
      );
      return view(rows[0] as Row);
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      const { rows } = await client.query(
        'SELECT id, label, original_name FROM health_documents WHERE user_id = $1 AND sha256 = $2',
        [owner, doc.sha256]
      );
      const existing = rows[0] as Row | undefined;
      throw fail(
        `This file is already stored${
          existing
            ? ` as ${String(existing['label'] ?? existing['original_name'])}`
            : ''
        }.`,
        409,
        { existing_id: existing ? String(existing['id']) : null }
      );
    }
  } finally {
    client.release();
  }
}

/** What is needed to send a stored original back, or null when it is not the owner's. */
export async function getHealthDocumentFile(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<{
  file_path: string;
  original_name: string;
  mime: HealthDocumentMime;
} | null> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      'SELECT file_path, original_name, mime FROM health_documents WHERE id = $1 AND user_id = $2',
      [id, owner]
    );
    const row = rows[0] as Row | undefined;
    return row
      ? {
          file_path: String(row['file_path']),
          original_name: String(row['original_name']),
          mime: row['mime'] as HealthDocumentMime,
        }
      : null;
  } finally {
    client.release();
  }
}

/** Removes the row and answers where its file was, or null when there was no such document. */
export async function deleteHealthDocument(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<string | null> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      'DELETE FROM health_documents WHERE id = $1 AND user_id = $2 RETURNING file_path',
      [id, owner]
    );
    return rows[0] ? String((rows[0] as Row)['file_path']) : null;
  } finally {
    client.release();
  }
}

/**
 * Ties a document already stored (the same bytes uploaded earlier) to an ECG recording, when it
 * is not tied to any record yet. It becomes an ECG report. Answers whether it was tied.
 */
export async function adoptHealthDocumentForEcg(
  owner: string,
  id: string,
  ecgRecordingId: string,
  documentDay: string,
  authenticatedUserId?: string
): Promise<boolean> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rowCount } = await client.query(
      `UPDATE health_documents
          SET kind = 'ecg_report', ecg_recording_id = $3,
              document_day = COALESCE(document_day, $4::date)
        WHERE id = $1 AND user_id = $2 AND body_comp_scan_id IS NULL
          AND metabolic_test_id IS NULL AND ecg_recording_id IS NULL`,
      [id, owner, ecgRecordingId, documentDay]
    );
    return Boolean(rowCount);
  } finally {
    client.release();
  }
}
