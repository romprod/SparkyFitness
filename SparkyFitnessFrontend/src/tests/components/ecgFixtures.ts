import type {
  EcgRecordingDetail,
  EcgRecordingSummary,
} from '@workspace/shared';

export const summary = (
  over: Partial<EcgRecordingSummary> = {}
): EcgRecordingSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  recorded_at: '2026-11-20T08:30:00.000Z',
  local_day: '2026-11-20',
  tz: 'Europe/London',
  result: 'Sinus Rhythm',
  avg_heart_rate_bpm: 62,
  symptoms: '--',
  interpretation: 'This ECG recording does not show signs of AFib.',
  lead_note: 'Lead I, single lead',
  duration_sec: 30,
  paper_speed_mm_s: 25,
  gain_mm_mv: 10,
  sample_rate_hz: 512,
  device_model: 'Forerunner 970',
  device_software: '19.04',
  pdf_template_version: '1.2.114',
  has_waveform: true,
  document_id: '22222222-2222-4222-8222-222222222222',
  ...over,
});

export const detail = (
  over: Partial<EcgRecordingDetail> = {}
): EcgRecordingDetail => ({
  ...summary(),
  waveform: {
    drawnHz: 128,
    durationMs: 10000,
    points: 4,
    droppedStrips: 0,
    strips: [{ t0Ms: 0, dtMs: 2500, uv: [0, 800, null, -200, 0] }],
  },
  ...over,
});
