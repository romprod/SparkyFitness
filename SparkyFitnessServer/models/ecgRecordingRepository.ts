import {
  ECG_LIST_LIMIT,
  type EcgRecordingDetail,
  type EcgRecordingSummary,
  type EcgWaveform,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

/**
 * Garmin ECG recordings of the owner, as the PDF printed them. The trace is one JSON object kept
 * with the row; lists never read it.
 */
type Row = Record<string, unknown>;

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** What an import writes: every field the report printed, ready for a row. */
export interface EcgRecordingData {
  recorded_at: Date;
  recorded_local_key: string;
  local_day: string;
  tz: string;
  result: string;
  avg_heart_rate_bpm: number | null;
  symptoms: string | null;
  interpretation: string | null;
  lead_note: string | null;
  duration_sec: number | null;
  paper_speed_mm_s: number | null;
  gain_mm_mv: number | null;
  sample_rate_hz: number | null;
  device_model: string | null;
  device_software: string | null;
  ecg_app_version: string | null;
  connect_web_version: string | null;
  pdf_template_version: string | null;
  backend_version: string | null;
  waveform: EcgWaveform | null;
  waveform_points: number | null;
  source_hash: string;
}

/** pg returns NUMERIC as text and TIMESTAMPTZ as a Date; the API carries numbers and ISO text. */
export function toEcgRecordingSummary(row: Row): EcgRecordingSummary {
  const recordedAt = row['recorded_at'];
  return {
    id: String(row['id']),
    recorded_at: (recordedAt instanceof Date
      ? recordedAt
      : new Date(String(recordedAt))
    ).toISOString(),
    local_day: String(row['local_day']),
    tz: String(row['tz']),
    result: String(row['result']),
    avg_heart_rate_bpm: num(row['avg_heart_rate_bpm']),
    symptoms: text(row['symptoms']),
    interpretation: text(row['interpretation']),
    lead_note: text(row['lead_note']),
    duration_sec: num(row['duration_sec']),
    paper_speed_mm_s: num(row['paper_speed_mm_s']),
    gain_mm_mv: num(row['gain_mm_mv']),
    sample_rate_hz: num(row['sample_rate_hz']),
    device_model: text(row['device_model']),
    device_software: text(row['device_software']),
    pdf_template_version: text(row['pdf_template_version']),
    has_waveform: Number(row['waveform_points'] ?? 0) > 0,
    document_id: text(row['document_id']),
  };
}

/** A stored trace back as a waveform; a value that is not one is treated as no trace. */
function toWaveform(value: unknown): EcgWaveform | null {
  const w = value as EcgWaveform | null;
  return w && Array.isArray(w.strips) && w.strips.length > 0 ? w : null;
}

const SUMMARY_COLUMNS = `r.id, r.recorded_at, r.local_day::text AS local_day, r.tz, r.result,
  r.avg_heart_rate_bpm, r.symptoms, r.interpretation, r.lead_note, r.duration_sec,
  r.paper_speed_mm_s, r.gain_mm_mv, r.sample_rate_hz, r.device_model, r.device_software,
  r.pdf_template_version, r.waveform_points,
  (SELECT d.id FROM health_documents d
    WHERE d.ecg_recording_id = r.id AND d.user_id = r.user_id
    ORDER BY d.created_at DESC, d.id LIMIT 1) AS document_id`;

/** The owner's recordings, newest first, without their traces. */
export async function listEcgRecordings(
  owner: string,
  authenticatedUserId?: string
): Promise<EcgRecordingSummary[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT ${SUMMARY_COLUMNS}
         FROM ecg_recordings r
        WHERE r.user_id = $1
        ORDER BY r.recorded_at DESC, r.id
        LIMIT $2`,
      [owner, ECG_LIST_LIMIT]
    );
    return (rows as Row[]).map(toEcgRecordingSummary);
  } finally {
    client.release();
  }
}

/** One recording with its trace, or null when it is not the owner's. */
export async function getEcgRecording(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<EcgRecordingDetail | null> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT ${SUMMARY_COLUMNS}, r.waveform
         FROM ecg_recordings r
        WHERE r.id = $1 AND r.user_id = $2`,
      [id, owner]
    );
    const row = rows[0] as Row | undefined;
    return row
      ? { ...toEcgRecordingSummary(row), waveform: toWaveform(row['waveform']) }
      : null;
  } finally {
    client.release();
  }
}

/** A recording of the owner made from exactly these file bytes, if any. */
export async function findEcgRecordingByHash(
  owner: string,
  sourceHash: string,
  authenticatedUserId?: string
): Promise<{ recorded_at: string } | null> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT recorded_at FROM ecg_recordings
        WHERE user_id = $1 AND source_hash = $2 LIMIT 1`,
      [owner, sourceHash]
    );
    const row = rows[0] as Row | undefined;
    return row
      ? { recorded_at: new Date(row['recorded_at'] as Date).toISOString() }
      : null;
  } finally {
    client.release();
  }
}

/** The recording at one printed minute, with what is needed to tell a re-download from a clash. */
export async function findEcgRecordingByLocalKey(
  owner: string,
  recordedLocalKey: string,
  authenticatedUserId?: string
): Promise<{ id: string; waveform_points: number | null } | null> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT id, waveform_points FROM ecg_recordings
        WHERE user_id = $1 AND recorded_local_key = $2`,
      [owner, recordedLocalKey]
    );
    const row = rows[0] as Row | undefined;
    return row
      ? { id: String(row['id']), waveform_points: num(row['waveform_points']) }
      : null;
  } finally {
    client.release();
  }
}

const WRITE_COLUMNS = [
  'recorded_at',
  'recorded_local_key',
  'local_day',
  'tz',
  'result',
  'avg_heart_rate_bpm',
  'symptoms',
  'interpretation',
  'lead_note',
  'duration_sec',
  'paper_speed_mm_s',
  'gain_mm_mv',
  'sample_rate_hz',
  'device_model',
  'device_software',
  'ecg_app_version',
  'connect_web_version',
  'pdf_template_version',
  'backend_version',
  'waveform',
  'waveform_points',
  'source_hash',
] as const;

function writeValues(data: EcgRecordingData): unknown[] {
  return WRITE_COLUMNS.map((column) =>
    column === 'waveform'
      ? data.waveform
        ? JSON.stringify(data.waveform)
        : null
      : data[column]
  );
}

/**
 * Adds a recording. Another one at the same printed minute (an import racing this one) fails
 * with Postgres code 23505, which the caller reads as already imported.
 */
export async function insertEcgRecording(
  owner: string,
  data: EcgRecordingData,
  authenticatedUserId?: string
): Promise<string> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const marks = WRITE_COLUMNS.map((column, i) =>
      column === 'waveform' ? `$${i + 2}::jsonb` : `$${i + 2}`
    );
    const { rows } = await client.query(
      `INSERT INTO ecg_recordings (user_id, ${WRITE_COLUMNS.join(', ')})
       VALUES ($1, ${marks.join(', ')})
       RETURNING id`,
      [owner, ...writeValues(data)]
    );
    return String((rows[0] as Row)['id']);
  } finally {
    client.release();
  }
}

/** Rewrites a recording from a fresh read of the same report. Answers whether it was found. */
export async function updateEcgRecording(
  owner: string,
  id: string,
  data: EcgRecordingData,
  authenticatedUserId?: string
): Promise<boolean> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const sets = WRITE_COLUMNS.map((column, i) =>
      column === 'waveform'
        ? `${column} = $${i + 3}::jsonb`
        : `${column} = $${i + 3}`
    );
    const { rowCount } = await client.query(
      `UPDATE ecg_recordings SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
      [id, owner, ...writeValues(data)]
    );
    return Boolean(rowCount);
  } finally {
    client.release();
  }
}

/** The stored PDFs tied to a recording, newest first. */
export async function listEcgDocumentIds(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<string[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    const { rows } = await client.query(
      `SELECT id FROM health_documents
        WHERE ecg_recording_id = $1 AND user_id = $2
        ORDER BY created_at DESC, id`,
      [id, owner]
    );
    return (rows as Row[]).map((row) => String(row['id']));
  } finally {
    client.release();
  }
}

/**
 * Removes a recording and the stored PDFs tied to it in one transaction, and answers the file
 * paths of those PDFs so the caller can remove the files once this has committed. A recording
 * already gone answers no paths.
 */
export async function deleteEcgRecording(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<string[]> {
  const client = await getClient(owner, authenticatedUserId);
  try {
    await client.query('BEGIN');
    try {
      const { rows } = await client.query(
        `DELETE FROM health_documents
          WHERE ecg_recording_id = $1 AND user_id = $2 AND kind = 'ecg_report'
          RETURNING file_path`,
        [id, owner]
      );
      await client.query(
        'DELETE FROM ecg_recordings WHERE id = $1 AND user_id = $2',
        [id, owner]
      );
      await client.query('COMMIT');
      return (rows as Row[]).map((row) => String(row['file_path']));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}
