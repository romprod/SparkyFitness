import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../db/poolManager.js', () => ({ getClient: mocks.getClient }));
import {
  deleteEcgRecording,
  findEcgRecordingByHash,
  findEcgRecordingByLocalKey,
  getEcgRecording,
  insertEcgRecording,
  listEcgDocumentIds,
  listEcgRecordings,
  toEcgRecordingSummary,
  updateEcgRecording,
  type EcgRecordingData,
} from '../models/ecgRecordingRepository.js';

const owner = '00000000-0000-4000-a000-000000000001';
const id = '00000000-0000-4000-a000-0000000000c1';
const rows = (list: unknown[] = []) => ({ rows: list, rowCount: list.length });
const row = {
  id,
  recorded_at: new Date('2024-06-11T23:17:00Z'),
  local_day: '2024-06-12',
  tz: 'Australia/Brisbane',
  result: 'Sinus Rhythm',
  avg_heart_rate_bpm: 61,
  symptoms: '--',
  interpretation: 'This ECG recording does not show signs of AFib.',
  lead_note: null,
  duration_sec: 30,
  paper_speed_mm_s: '25',
  gain_mm_mv: '10',
  sample_rate_hz: 512,
  device_model: 'fenix 9 Pro',
  device_software: '6.38',
  pdf_template_version: '1.2.114',
  waveform_points: 750,
  document_id: null,
};
const data: EcgRecordingData = {
  recorded_at: new Date('2024-06-11T23:17:00Z'),
  recorded_local_key: '2024-06-12T09:17',
  local_day: '2024-06-12',
  tz: 'Australia/Brisbane',
  result: 'Sinus Rhythm',
  avg_heart_rate_bpm: 61,
  symptoms: '--',
  interpretation: null,
  lead_note: null,
  duration_sec: 30,
  paper_speed_mm_s: 25,
  gain_mm_mv: 10,
  sample_rate_hz: 512,
  device_model: null,
  device_software: null,
  ecg_app_version: null,
  connect_web_version: null,
  pdf_template_version: '1.2.114',
  backend_version: null,
  waveform: {
    drawnHz: 128,
    durationMs: 10000,
    strips: [{ t0Ms: 0, dtMs: 7.8, uv: [0, null, 5] }],
    points: 2,
    droppedStrips: 0,
  },
  waveform_points: 2,
  source_hash: 'a'.repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});

describe('reading back', () => {
  it('turns numeric text into numbers and the time into ISO', () => {
    expect(toEcgRecordingSummary(row)).toEqual({
      id,
      recorded_at: '2024-06-11T23:17:00.000Z',
      local_day: '2024-06-12',
      tz: 'Australia/Brisbane',
      result: 'Sinus Rhythm',
      avg_heart_rate_bpm: 61,
      symptoms: '--',
      interpretation: 'This ECG recording does not show signs of AFib.',
      lead_note: null,
      duration_sec: 30,
      paper_speed_mm_s: 25,
      gain_mm_mv: 10,
      sample_rate_hz: 512,
      device_model: 'fenix 9 Pro',
      device_software: '6.38',
      pdf_template_version: '1.2.114',
      has_waveform: true,
      document_id: null,
    });
    expect(
      toEcgRecordingSummary({ ...row, waveform_points: null }).has_waveform
    ).toBe(false);
  });

  it('lists the owner’s, newest first, at most 200, without reading the trace', async () => {
    mocks.query.mockResolvedValueOnce(rows([row]));
    const list = await listEcgRecordings(owner, owner);
    expect(list).toHaveLength(1);
    const [text, params] = mocks.query.mock.calls[0]!;
    expect(String(text)).toContain('WHERE r.user_id = $1');
    expect(String(text)).toContain('ORDER BY r.recorded_at DESC');
    expect(String(text)).not.toContain('r.waveform,');
    expect(String(text)).not.toMatch(/r\.waveform\b(?!_)/);
    expect(params).toEqual([owner, 200]);
    expect(mocks.getClient).toHaveBeenCalledWith(owner, owner);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('reads one with its trace, scoped to the owner, and answers null for another’s', async () => {
    const waveform = data.waveform;
    mocks.query.mockResolvedValueOnce(rows([{ ...row, waveform }]));
    const found = await getEcgRecording(owner, id, owner);
    expect(found?.waveform).toEqual(waveform);
    expect(String(mocks.query.mock.calls[0]![0])).toContain('r.waveform');
    expect(mocks.query.mock.calls[0]![1]).toEqual([id, owner]);

    mocks.query.mockResolvedValueOnce(rows());
    expect(await getEcgRecording(owner, id, owner)).toBeNull();
    // A trace that is not a list of strips reads as no trace.
    mocks.query.mockResolvedValueOnce(rows([{ ...row, waveform: {} }]));
    expect((await getEcgRecording(owner, id))?.waveform).toBeNull();
    expect(mocks.release).toHaveBeenCalledTimes(3);
  });

  it('finds a recording by file hash and by printed minute, for the owner only', async () => {
    mocks.query.mockResolvedValueOnce(rows([{ recorded_at: row.recorded_at }]));
    expect(await findEcgRecordingByHash(owner, 'h')).toEqual({
      recorded_at: '2024-06-11T23:17:00.000Z',
    });
    expect(mocks.query.mock.calls[0]![1]).toEqual([owner, 'h']);
    mocks.query.mockResolvedValueOnce(rows());
    expect(await findEcgRecordingByHash(owner, 'h')).toBeNull();

    mocks.query.mockResolvedValueOnce(rows([{ id, waveform_points: 750 }]));
    expect(await findEcgRecordingByLocalKey(owner, '2024-06-12T09:17')).toEqual(
      { id, waveform_points: 750 }
    );
    expect(mocks.query.mock.calls[2]![1]).toEqual([owner, '2024-06-12T09:17']);
    mocks.query.mockResolvedValueOnce(rows());
    expect(
      await findEcgRecordingByLocalKey(owner, '2024-06-12T09:18')
    ).toBeNull();
  });

  it('lists the PDFs tied to a recording', async () => {
    mocks.query.mockResolvedValueOnce(rows([{ id: 'd1' }, { id: 'd2' }]));
    expect(await listEcgDocumentIds(owner, id)).toEqual(['d1', 'd2']);
    expect(mocks.query.mock.calls[0]![1]).toEqual([id, owner]);
  });
});

describe('writing', () => {
  it('inserts for the owner, with the trace as JSON, and answers the id', async () => {
    mocks.query.mockResolvedValueOnce(rows([{ id }]));
    expect(await insertEcgRecording(owner, data, owner)).toBe(id);
    const [text, params] = mocks.query.mock.calls[0]! as [string, unknown[]];
    expect(text).toContain('INSERT INTO ecg_recordings (user_id, recorded_at');
    expect(text).toMatch(/\$21::jsonb/);
    // 22 columns after the owner.
    expect(params).toHaveLength(23);
    expect(params[0]).toBe(owner);
    expect(params[2]).toBe('2024-06-12T09:17');
    expect(params[20]).toBe(JSON.stringify(data.waveform));
    expect(params[22]).toBe('a'.repeat(64));
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('writes no trace as null, and lets a racing duplicate through with its code', async () => {
    mocks.query.mockResolvedValueOnce(rows([{ id }]));
    await insertEcgRecording(owner, { ...data, waveform: null });
    expect((mocks.query.mock.calls[0]![1] as unknown[])[20]).toBeNull();
    mocks.query.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: '23505' })
    );
    await expect(insertEcgRecording(owner, data)).rejects.toMatchObject({
      code: '23505',
    });
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('updates only the owner’s row and says whether it was found', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await updateEcgRecording(owner, id, data)).toBe(true);
    const [text, params] = mocks.query.mock.calls[0]! as [string, unknown[]];
    expect(text).toContain('WHERE id = $1 AND user_id = $2');
    expect(text).toContain('waveform = $22::jsonb');
    expect(params.slice(0, 2)).toEqual([id, owner]);
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await updateEcgRecording(owner, id, data)).toBe(false);
  });
});

describe('deleting', () => {
  it('removes the recording and its ECG report rows in one transaction, answering their files', async () => {
    mocks.query
      .mockResolvedValueOnce(rows()) // BEGIN
      .mockResolvedValueOnce(
        rows([{ file_path: 'uploads/health-documents/u/a.pdf' }])
      )
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows()); // COMMIT
    expect(await deleteEcgRecording(owner, id, owner)).toEqual([
      'uploads/health-documents/u/a.pdf',
    ]);
    const calls = mocks.query.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('DELETE FROM health_documents');
    expect(calls[1]).toContain("kind = 'ecg_report'");
    expect(mocks.query.mock.calls[1]![1]).toEqual([id, owner]);
    expect(calls[2]).toContain('DELETE FROM ecg_recordings');
    expect(mocks.query.mock.calls[2]![1]).toEqual([id, owner]);
    expect(calls[3]).toBe('COMMIT');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('answers no files for a recording already gone', async () => {
    mocks.query.mockResolvedValue(rows());
    expect(await deleteEcgRecording(owner, id)).toEqual([]);
  });

  it('rolls back and fails when a step fails', async () => {
    mocks.query
      .mockResolvedValueOnce(rows()) // BEGIN
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(rows()); // ROLLBACK
    await expect(deleteEcgRecording(owner, id)).rejects.toThrow('boom');
    expect(String(mocks.query.mock.calls[2]![0])).toBe('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
