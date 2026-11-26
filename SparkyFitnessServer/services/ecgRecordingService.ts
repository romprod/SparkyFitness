import { createHash } from 'crypto';
import {
  ECG_IMPORT_MAX_FILE_BYTES,
  instantToDay,
  localDateTimeToUtc,
  localTimeKey,
  parseEcgReport,
  type EcgImportOutcome,
  type EcgReport,
  type HealthDocumentFields,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import { adoptHealthDocumentForEcg } from '../models/healthDocumentRepository.js';
import {
  deleteEcgRecording,
  findEcgRecordingByHash,
  findEcgRecordingByLocalKey,
  insertEcgRecording,
  listEcgDocumentIds,
  updateEcgRecording,
  type EcgRecordingData,
} from '../models/ecgRecordingRepository.js';
import {
  discardHealthDocumentFile,
  removeHealthDocument,
  storeHealthDocument,
} from './healthDocumentService.js';
import { extractEcgPdf } from './ecgPdf.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

/**
 * Garmin ECG import and delete. Ported from Pitstop's importOne and deleteEcgRecording. The
 * outcomes are the same, one for each file, in the order sent.
 *
 * Differences from Pitstop, on purpose: the printed clock is read in the user's profile time
 * zone (Pitstop uses the importing device's); the stored PDF is a health document of kind
 * ecg_report, and the stored file name is made from the recording's time, never the uploaded
 * name; there is no audit log row, orphan sweep or field encryption.
 */

/** A file as multer hands it over. */
export interface EcgUploadFile {
  buffer: Buffer;
  originalname?: string;
}

const STORE_FAILED = 'Could not store the file.';

/** A short, safe label for the results list. Never stored and never used as a path. */
export function ecgDisplayName(name: unknown, index: number): string {
  const raw = typeof name === 'string' ? name : '';
  // Strip control characters so a crafted name cannot rewrite the line it is printed on.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return `File ${index + 1}`;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

/** Report fields as a row. The report is stored as Garmin printed it. */
function rowData(
  report: EcgReport,
  recordedAt: Date,
  recordedLocalKey: string,
  tz: string,
  sourceHash: string
): EcgRecordingData {
  const waveform = report.waveform;
  return {
    recorded_at: recordedAt,
    recorded_local_key: recordedLocalKey,
    local_day: instantToDay(recordedAt, tz),
    tz,
    result: report.result,
    avg_heart_rate_bpm: report.avgHeartRateBpm,
    // Verbatim, "--" included: the printed "none" is not the same as "not read".
    symptoms: report.symptoms || null,
    interpretation: report.interpretation || null,
    lead_note: report.leadNote,
    duration_sec: report.durationSec,
    paper_speed_mm_s: report.paperSpeedMmS,
    gain_mm_mv: report.gainMmMv,
    sample_rate_hz:
      report.sampleRateHz === null ? null : Math.round(report.sampleRateHz),
    device_model: report.deviceModel,
    device_software: report.deviceSoftware,
    ecg_app_version: report.ecgAppVersion,
    connect_web_version: report.connectWebVersion,
    pdf_template_version: report.pdfTemplateVersion,
    backend_version: report.backendVersion,
    waveform,
    waveform_points: waveform?.points ?? null,
    source_hash: sourceHash,
  };
}

/**
 * Keeps the PDF as the recording's original. When the same bytes are already stored as a
 * document, no second copy is made: an unlinked document is tied to the recording (and becomes
 * an ECG report); one that belongs to another record is left alone and the recording goes
 * without a link. `linked` says whether the recording now has this file as its original.
 */
async function storeOriginal(
  owner: string,
  recordingId: string,
  localDay: string,
  recordedLocalKey: string,
  buffer: Buffer,
  actor: string | undefined
): Promise<{ id: string | null; linked: boolean }> {
  try {
    const stored = await storeHealthDocument(
      owner,
      {
        buffer,
        originalname: `ecg-${recordedLocalKey.replace('T', '-').replace(':', '')}.pdf`,
      },
      {
        kind: 'ecg_report',
        label: null,
        document_day: localDay,
        body_comp_scan_id: null,
        metabolic_test_id: null,
        ecg_recording_id: recordingId,
      } satisfies HealthDocumentFields,
      actor
    );
    return { id: stored.id, linked: true };
  } catch (error) {
    const existingId = (error as { existing_id?: string | null }).existing_id;
    if ((error as { statusCode?: number }).statusCode !== 409 || !existingId)
      throw error;
    const linked = await adoptHealthDocumentForEcg(
      owner,
      existingId,
      recordingId,
      localDay,
      actor
    );
    return { id: existingId, linked };
  }
}

const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown })?.code === '23505';

async function importOne(
  owner: string,
  tz: string,
  file: EcgUploadFile,
  name: string,
  actor: string | undefined
): Promise<EcgImportOutcome> {
  if (file.buffer.length > ECG_IMPORT_MAX_FILE_BYTES)
    return {
      file: name,
      status: 'failed',
      message: 'This file is larger than 10 MB.',
    };
  const sourceHash = createHash('sha256').update(file.buffer).digest('hex');

  // The cheapest duplicate check there is: this exact file, already imported.
  const sameFile = await findEcgRecordingByHash(owner, sourceHash, actor);
  if (sameFile)
    return {
      file: name,
      status: 'duplicate',
      message: 'Already imported.',
      recordedAtIso: sameFile.recorded_at,
    };

  // Parse before storing anything, so an unreadable upload leaves no trace.
  let parsed;
  try {
    parsed = parseEcgReport(await extractEcgPdf(file.buffer));
  } catch (error) {
    log('error', 'ECG import: extraction failed', error);
    return {
      file: name,
      status: 'failed',
      message: 'This PDF could not be read.',
    };
  }
  if (!parsed.ok || !parsed.report) {
    // A file with nothing recognisable in it is simply the wrong file; the list of what it lacks
    // is worth printing only when the report was partly readable, when a template change is the
    // likely cause.
    const partial = parsed.confidence > 0 && parsed.missing.length > 0;
    const what = partial
      ? ` Could not find: ${parsed.missing.join(', ')}.`
      : '';
    return {
      file: name,
      status: 'failed',
      message: `This does not look like a Garmin ECG report.${what}`,
      missing: parsed.missing,
    };
  }

  const report = parsed.report;
  const recordedLocalKey = localTimeKey(report.recordedAtLocal);
  const recordedAt = localDateTimeToUtc(recordedLocalKey, tz);
  const recordedAtIso = recordedAt.toISOString();
  const data = rowData(report, recordedAt, recordedLocalKey, tz, sourceHash);

  const existing = await findEcgRecordingByLocalKey(
    owner,
    recordedLocalKey,
    actor
  );

  // The printed time is minute-precision, so two different recordings in one minute would share
  // a key. Overwriting a stored recording with a different one would be silent data loss, so a
  // materially different trace at the same printed time is refused. A re-download of the same
  // recording has a matching trace and refreshes.
  const incoming = report.waveform?.points ?? null;
  if (existing && existing.waveform_points !== null && incoming !== null) {
    const drift =
      Math.abs(existing.waveform_points - incoming) / existing.waveform_points;
    if (drift > 0.05)
      return {
        file: name,
        status: 'failed',
        message:
          'A different recording is already stored at this time. Delete that one first if this should replace it.',
        recordedAtIso,
      };
  }

  const done = (status: 'imported' | 'updated'): EcgImportOutcome => ({
    file: name,
    status,
    message:
      status === 'updated'
        ? 'Refreshed the recording already stored for this time.'
        : 'Imported.',
    recordedAtIso,
    result: report.result,
    avgHeartRateBpm: report.avgHeartRateBpm,
    missing: parsed.missing,
  });

  if (existing) {
    // Keep the new PDF first, so a failure leaves the stored recording as it was.
    const oldDocuments = await listEcgDocumentIds(owner, existing.id, actor);
    let original: { id: string | null; linked: boolean };
    try {
      original = await storeOriginal(
        owner,
        existing.id,
        data.local_day,
        recordedLocalKey,
        file.buffer,
        actor
      );
    } catch (error) {
      log('error', 'ECG import: storing the PDF failed', error);
      return { file: name, status: 'failed', message: STORE_FAILED };
    }
    try {
      await updateEcgRecording(owner, existing.id, data, actor);
    } catch (error) {
      if (isUniqueViolation(error))
        return {
          file: name,
          status: 'duplicate',
          message: 'Already imported.',
          recordedAtIso,
        };
      log('error', 'ECG import: write failed', error);
      return {
        file: name,
        status: 'failed',
        message: 'Could not save this recording.',
      };
    }
    // The superseded originals go only once the recording points at the new one.
    if (original.linked)
      for (const id of oldDocuments.filter((x) => x !== original.id))
        await removeHealthDocument(owner, id, actor).catch((error) =>
          log('error', 'ECG import: removing a superseded PDF failed', error)
        );
    return done('updated');
  }

  let id: string;
  try {
    id = await insertEcgRecording(owner, data, actor);
  } catch (error) {
    // Two imports of one recording racing: the loser trips the unique key. That is the
    // duplicate case, not a storage failure.
    if (isUniqueViolation(error))
      return {
        file: name,
        status: 'duplicate',
        message: 'Already imported.',
        recordedAtIso,
      };
    log('error', 'ECG import: write failed', error);
    return {
      file: name,
      status: 'failed',
      message: 'Could not save this recording.',
    };
  }
  try {
    await storeOriginal(
      owner,
      id,
      data.local_day,
      recordedLocalKey,
      file.buffer,
      actor
    );
  } catch (error) {
    log('error', 'ECG import: storing the PDF failed', error);
    // Take the recording back out: an import is the recording and its PDF, or neither.
    await removeEcgRecording(owner, id, actor).catch(() => undefined);
    return { file: name, status: 'failed', message: STORE_FAILED };
  }
  return done('imported');
}

/**
 * Imports Garmin ECG PDFs, one after another (pdf.js is CPU-bound, and 25 at once would starve
 * the rest of the server). A recording is identified by when it was recorded, never by the file
 * name, so uploading the same export again is safe. Each file has its own outcome.
 */
export async function importEcgReports(
  owner: string,
  files: EcgUploadFile[],
  authenticatedUserId?: string
): Promise<EcgImportOutcome[]> {
  const tz = await loadUserTimezone(owner);
  const outcomes: EcgImportOutcome[] = [];
  for (const [index, file] of files.entries()) {
    const name = ecgDisplayName(file.originalname, index);
    try {
      outcomes.push(
        await importOne(owner, tz, file, name, authenticatedUserId)
      );
    } catch (error) {
      log('error', 'ECG import: unexpected failure', error);
      outcomes.push({
        file: name,
        status: 'failed',
        message: 'Something went wrong reading this report.',
      });
    }
  }
  return outcomes;
}

/**
 * Deletes a recording and its stored PDF. The files go after the database change has committed,
 * so a failed removal leaves a stray file, never a row pointing at nothing. A recording already
 * gone counts as deleted.
 */
export async function removeEcgRecording(
  owner: string,
  id: string,
  authenticatedUserId?: string
): Promise<void> {
  const filePaths = await deleteEcgRecording(owner, id, authenticatedUserId);
  for (const filePath of filePaths)
    await discardHealthDocumentFile(filePath).catch((error) =>
      log('error', 'ECG delete: removing the PDF failed', error)
    );
}
