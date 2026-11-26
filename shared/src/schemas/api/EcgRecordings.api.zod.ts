import { z } from 'zod';

/** At most this many reports in one import, each at most this big (matches Pitstop's upload). */
export const ECG_IMPORT_MAX_FILES = 25;
export const ECG_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The list answers at most this many recordings, newest first. */
export const ECG_LIST_LIMIT = 200;

/**
 * The trace as drawn in the PDF (about 128 Hz, not the watch's 512 Hz). Each strip is on its own
 * uniform time grid, in microvolts about its own baseline; null is a stretch the export did not
 * draw. Field names are the parser's (utils/ecgReport.ts).
 */
export const ecgWaveformStripSchema = z.object({
  t0Ms: z.number(),
  dtMs: z.number(),
  uv: z.array(z.number().nullable()),
});
export const ecgWaveformSchema = z.object({
  drawnHz: z.number(),
  durationMs: z.number(),
  strips: z.array(ecgWaveformStripSchema),
  points: z.number(),
  droppedStrips: z.number(),
});

/** One recording without its trace: what a list shows. Garmin's words are as printed. */
export const ecgRecordingSummarySchema = z.object({
  id: z.string().uuid(),
  /** The printed wall clock read in `tz`, as an ISO instant. */
  recorded_at: z.string(),
  local_day: z.string(),
  tz: z.string(),
  result: z.string(),
  avg_heart_rate_bpm: z.number().nullable(),
  /** Verbatim, "--" included; null only when it was not read. */
  symptoms: z.string().nullable(),
  interpretation: z.string().nullable(),
  lead_note: z.string().nullable(),
  duration_sec: z.number().nullable(),
  paper_speed_mm_s: z.number().nullable(),
  gain_mm_mv: z.number().nullable(),
  sample_rate_hz: z.number().nullable(),
  device_model: z.string().nullable(),
  device_software: z.string().nullable(),
  pdf_template_version: z.string().nullable(),
  has_waveform: z.boolean(),
  /** The stored PDF (a health document of kind ecg_report), if there is one. */
  document_id: z.string().uuid().nullable(),
});
export type EcgRecordingSummary = z.infer<typeof ecgRecordingSummarySchema>;

export const ecgRecordingDetailSchema = ecgRecordingSummarySchema.extend({
  waveform: ecgWaveformSchema.nullable(),
});
export type EcgRecordingDetail = z.infer<typeof ecgRecordingDetailSchema>;

export const ecgRecordingListSchema = z.object({
  ecg_recordings: z.array(ecgRecordingSummarySchema),
});
export const ecgRecordingDetailResponseSchema = z.object({
  ecg_recording: ecgRecordingDetailSchema,
});

export const ECG_IMPORT_STATUSES = [
  'imported',
  'updated',
  'duplicate',
  'failed',
] as const;
export type EcgImportStatus = (typeof ECG_IMPORT_STATUSES)[number];

/** One upload's outcome. `file` is a display name only; it is never stored. */
export const ecgImportOutcomeSchema = z.object({
  file: z.string(),
  status: z.enum(ECG_IMPORT_STATUSES),
  message: z.string(),
  recordedAtIso: z.string().optional(),
  result: z.string().optional(),
  avgHeartRateBpm: z.number().nullable().optional(),
  missing: z.array(z.string()).optional(),
});
export type EcgImportOutcome = z.infer<typeof ecgImportOutcomeSchema>;

export const ecgImportResponseSchema = z.object({
  outcomes: z.array(ecgImportOutcomeSchema),
});
export type EcgImportResponse = z.infer<typeof ecgImportResponseSchema>;
