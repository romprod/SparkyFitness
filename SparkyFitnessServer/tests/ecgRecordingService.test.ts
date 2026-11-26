import { beforeEach, describe, expect, it, vi } from 'vitest';
import { build, syntheticReport } from './fixtures/ecgReportPdf.js';

const owner = '00000000-0000-4000-a000-000000000001';
const recId = '00000000-0000-4000-a000-0000000000c1';
const docId = '00000000-0000-4000-a000-0000000000d1';
const oldDocId = '00000000-0000-4000-a000-0000000000d2';

const mocks = vi.hoisted(() => ({
  findByHash: vi.fn(),
  findByKey: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  listDocs: vi.fn(),
  remove: vi.fn(),
  adopt: vi.fn(),
  store: vi.fn(),
  removeDoc: vi.fn(),
  discard: vi.fn(),
  timezone: vi.fn(),
}));
vi.mock('../models/ecgRecordingRepository.js', () => ({
  findEcgRecordingByHash: mocks.findByHash,
  findEcgRecordingByLocalKey: mocks.findByKey,
  insertEcgRecording: mocks.insert,
  updateEcgRecording: mocks.update,
  listEcgDocumentIds: mocks.listDocs,
  deleteEcgRecording: mocks.remove,
}));
vi.mock('../models/healthDocumentRepository.js', () => ({
  adoptHealthDocumentForEcg: mocks.adopt,
}));
vi.mock('../services/healthDocumentService.js', () => ({
  storeHealthDocument: mocks.store,
  removeHealthDocument: mocks.removeDoc,
  discardHealthDocumentFile: mocks.discard,
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: mocks.timezone,
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
import {
  ecgDisplayName,
  importEcgReports,
  removeEcgRecording,
} from '../services/ecgRecordingService.js';

const file = (buffer: Buffer, originalname = 'report.pdf') => ({
  buffer,
  originalname,
});
const stored = { id: docId };

beforeEach(() => {
  vi.resetAllMocks();
  // Brisbane has no daylight saving: 09:17 there is 23:17 UTC the day before.
  mocks.timezone.mockResolvedValue('Australia/Brisbane');
  mocks.findByHash.mockResolvedValue(null);
  mocks.findByKey.mockResolvedValue(null);
  mocks.insert.mockResolvedValue(recId);
  mocks.update.mockResolvedValue(true);
  mocks.listDocs.mockResolvedValue([]);
  mocks.remove.mockResolvedValue([]);
  mocks.store.mockResolvedValue(stored);
  mocks.removeDoc.mockResolvedValue(undefined);
  mocks.discard.mockResolvedValue(undefined);
});

describe('a new report', () => {
  it('is read, saved with its PDF, and echoed back without the name or file name stored', async () => {
    const [outcome] = await importEcgReports(
      owner,
      [file(await syntheticReport(), 'Jordan Fixtureson ECG.pdf')],
      owner
    );
    expect(outcome).toEqual({
      file: 'Jordan Fixtureson ECG.pdf',
      status: 'imported',
      message: 'Imported.',
      recordedAtIso: '2024-06-11T23:17:00.000Z',
      result: 'Sinus Rhythm',
      avgHeartRateBpm: 61,
      missing: [],
    });

    const [calledOwner, data, calledActor] = mocks.insert.mock.calls[0]!;
    expect(calledOwner).toBe(owner);
    expect(calledActor).toBe(owner);
    expect(data).toMatchObject({
      recorded_local_key: '2024-06-12T09:17',
      local_day: '2024-06-12',
      tz: 'Australia/Brisbane',
      result: 'Sinus Rhythm',
      avg_heart_rate_bpm: 61,
      symptoms: '--',
      interpretation: 'This ECG recording does not show signs of AFib.',
      lead_note: 'This waveform is similar to a Lead I ECG.',
      duration_sec: 30,
      sample_rate_hz: 512,
      pdf_template_version: '1.2.114',
      waveform_points: 750,
    });
    expect(String(data.source_hash)).toMatch(/^[0-9a-f]{64}$/);
    const printed = JSON.stringify(data);
    for (const identifying of ['Jordan', 'Fixtureson', '1979', 'Female'])
      expect(printed).not.toContain(identifying);

    const [storeOwner, upload, fields, storeActor] = mocks.store.mock.calls[0]!;
    expect(storeOwner).toBe(owner);
    expect(storeActor).toBe(owner);
    expect(upload.originalname).toBe('ecg-2024-06-12-0917.pdf');
    expect(fields).toEqual({
      kind: 'ecg_report',
      label: null,
      document_day: '2024-06-12',
      body_comp_scan_id: null,
      metabolic_test_id: null,
      ecg_recording_id: recId,
    });
    expect(mocks.update).not.toHaveBeenCalled();
  }, 30_000);

  it('reads the printed clock in the profile time zone, keeping the same identity', async () => {
    mocks.timezone.mockResolvedValue('America/New_York');
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome!.recordedAtIso).toBe('2024-06-12T13:17:00.000Z');
    expect(mocks.insert.mock.calls[0]![1]).toMatchObject({
      recorded_local_key: '2024-06-12T09:17',
      local_day: '2024-06-12',
      tz: 'America/New_York',
    });
  }, 30_000);

  it('files the recording under the day it was recorded in that zone', async () => {
    mocks.timezone.mockResolvedValue('UTC');
    await importEcgReports(owner, [
      file(await syntheticReport({ recordedAt: '12 June 2024 @ 11:58 PM' })),
    ]);
    expect(mocks.insert.mock.calls[0]![1]).toMatchObject({
      recorded_local_key: '2024-06-12T23:58',
      local_day: '2024-06-12',
    });
  }, 30_000);
});

describe('what is refused', () => {
  it('answers duplicate for the same file, without reading or storing it', async () => {
    mocks.findByHash.mockResolvedValue({
      recorded_at: '2024-06-11T23:17:00.000Z',
    });
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome).toEqual({
      file: 'report.pdf',
      status: 'duplicate',
      message: 'Already imported.',
      recordedAtIso: '2024-06-11T23:17:00.000Z',
    });
    expect(mocks.findByKey).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  }, 30_000);

  it('fails a file that is not a PDF, storing nothing', async () => {
    const [outcome] = await importEcgReports(owner, [
      file(Buffer.from('not a pdf at all\n')),
    ]);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'This PDF could not be read.',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  }, 30_000);

  it('fails a PDF with no text with the plain sentence and no list', async () => {
    const pdf = await build((doc) => {
      doc.rect(50, 50, 200, 100).stroke();
    });
    const [outcome] = await importEcgReports(owner, [file(pdf)]);
    expect(outcome!.status).toBe('failed');
    expect(outcome!.message).toBe(
      'This does not look like a Garmin ECG report.'
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  }, 30_000);

  it('lists what could not be found when the report was only partly readable', async () => {
    const pdf = await build((doc) => {
      doc.fontSize(10).text('12 June 2024 @ 9:17 AM', 66, 40, {
        lineBreak: false,
      });
      doc.fontSize(8).text('Recorded on fenix 9 Pro 6.38', 30, 596, {
        lineBreak: false,
      });
    });
    const [outcome] = await importEcgReports(owner, [file(pdf)]);
    expect(outcome!.status).toBe('failed');
    expect(outcome!.message).toMatch(
      /^This does not look like a Garmin ECG report\. Could not find: result, .+\.$/
    );
    expect(outcome!.missing).toContain('result');
    expect(mocks.insert).not.toHaveBeenCalled();
  }, 30_000);

  it('fails a file over 10 MB without reading it', async () => {
    const [outcome] = await importEcgReports(owner, [
      file(Buffer.alloc(10 * 1024 * 1024 + 1)),
    ]);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'This file is larger than 10 MB.',
    });
    expect(mocks.findByHash).not.toHaveBeenCalled();
  });

  it('refuses a materially different trace at an already stored minute', async () => {
    mocks.findByKey.mockResolvedValue({ id: recId, waveform_points: 750 });
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport({ points: 400 })),
    ]);
    expect(outcome).toEqual({
      file: 'report.pdf',
      status: 'failed',
      message:
        'A different recording is already stored at this time. Delete that one first if this should replace it.',
      recordedAtIso: '2024-06-11T23:17:00.000Z',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  }, 30_000);

  it('answers duplicate when an import racing this one saved the same minute first', async () => {
    mocks.insert.mockRejectedValue(
      Object.assign(new Error('unique'), { code: '23505' })
    );
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome).toMatchObject({
      status: 'duplicate',
      message: 'Already imported.',
    });
    expect(mocks.store).not.toHaveBeenCalled();
  }, 30_000);
});

describe('a report for a minute already stored', () => {
  it('refreshes the row, replaces the PDF and removes the old one after the new is linked', async () => {
    mocks.findByKey.mockResolvedValue({ id: recId, waveform_points: 740 });
    mocks.listDocs.mockResolvedValue([oldDocId]);
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome).toMatchObject({
      status: 'updated',
      message: 'Refreshed the recording already stored for this time.',
      recordedAtIso: '2024-06-11T23:17:00.000Z',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0]![1]).toBe(recId);
    expect(mocks.store.mock.calls[0]![2]).toMatchObject({
      ecg_recording_id: recId,
    });
    expect(mocks.removeDoc).toHaveBeenCalledWith(owner, oldDocId, undefined);
    // The new PDF is kept before the row is rewritten, and the old one goes last.
    const order = (m: { mock: { invocationCallOrder: number[] } }) =>
      m.mock.invocationCallOrder[0]!;
    expect(order(mocks.store)).toBeLessThan(order(mocks.update));
    expect(order(mocks.update)).toBeLessThan(order(mocks.removeDoc));
  }, 30_000);

  it('leaves the stored recording as it was when the new PDF cannot be kept', async () => {
    mocks.findByKey.mockResolvedValue({ id: recId, waveform_points: 750 });
    mocks.listDocs.mockResolvedValue([oldDocId]);
    mocks.store.mockRejectedValue(new Error('disk full'));
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'Could not store the file.',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.removeDoc).not.toHaveBeenCalled();
  }, 30_000);
});

describe('a PDF already stored as a document', () => {
  const alreadyStored = Object.assign(new Error('stored'), {
    statusCode: 409,
    existing_id: docId,
  });

  it('ties the unlinked document to the new recording instead of storing a second copy', async () => {
    mocks.store.mockRejectedValue(alreadyStored);
    mocks.adopt.mockResolvedValue(true);
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome!.status).toBe('imported');
    expect(mocks.adopt).toHaveBeenCalledWith(
      owner,
      docId,
      recId,
      '2024-06-12',
      undefined
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  }, 30_000);

  it('imports the recording without a link when the document belongs to another record', async () => {
    mocks.store.mockRejectedValue(alreadyStored);
    mocks.adopt.mockResolvedValue(false);
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome!.status).toBe('imported');
    expect(mocks.remove).not.toHaveBeenCalled();
  }, 30_000);

  it('keeps the old PDF of a refreshed recording when the new one could not be linked', async () => {
    mocks.findByKey.mockResolvedValue({ id: recId, waveform_points: 750 });
    mocks.listDocs.mockResolvedValue([oldDocId]);
    mocks.store.mockRejectedValue(alreadyStored);
    mocks.adopt.mockResolvedValue(false);
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome!.status).toBe('updated');
    expect(mocks.removeDoc).not.toHaveBeenCalled();
  }, 30_000);

  it('takes a new recording back out when its PDF cannot be stored', async () => {
    mocks.store.mockRejectedValue(new Error('disk full'));
    const [outcome] = await importEcgReports(owner, [
      file(await syntheticReport()),
    ]);
    expect(outcome).toMatchObject({
      status: 'failed',
      message: 'Could not store the file.',
    });
    expect(mocks.remove).toHaveBeenCalledWith(owner, recId, undefined);
  }, 30_000);
});

describe('a batch', () => {
  it('goes one file at a time, in order, each with its own outcome', async () => {
    mocks.findByKey.mockResolvedValue(null);
    mocks.insert.mockResolvedValueOnce(recId);
    const outcomes = await importEcgReports(owner, [
      file(await syntheticReport(), 'a.pdf'),
      file(Buffer.from('nope'), 'b.pdf'),
      file(
        await syntheticReport({ recordedAt: '13 June 2024 @ 8:05 AM' }),
        'c.pdf'
      ),
    ]);
    expect(outcomes.map((o) => [o.file, o.status])).toEqual([
      ['a.pdf', 'imported'],
      ['b.pdf', 'failed'],
      ['c.pdf', 'imported'],
    ]);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('turns an unexpected error into a failed line instead of stopping the rest', async () => {
    mocks.findByHash.mockRejectedValueOnce(new Error('db down'));
    const outcomes = await importEcgReports(owner, [
      file(Buffer.from('x'), 'a.pdf'),
      file(await syntheticReport(), 'b.pdf'),
    ]);
    expect(outcomes[0]).toEqual({
      file: 'a.pdf',
      status: 'failed',
      message: 'Something went wrong reading this report.',
    });
    expect(outcomes[1]!.status).toBe('imported');
  }, 30_000);
});

describe('the name shown back', () => {
  it('strips control characters, shortens to 80, and falls back to File N', () => {
    expect(ecgDisplayName('a\u0000b\nc\u007f.pdf', 0)).toBe('abc.pdf');
    expect(ecgDisplayName('x'.repeat(200), 0)).toHaveLength(78);
    expect(ecgDisplayName('x'.repeat(200), 0).endsWith('…')).toBe(true);
    expect(ecgDisplayName('x'.repeat(80), 0)).toBe('x'.repeat(80));
    expect(ecgDisplayName('  \u0001 ', 2)).toBe('File 3');
    expect(ecgDisplayName(undefined, 0)).toBe('File 1');
  });
});

describe('deleting', () => {
  it('removes the files only once the database change is done', async () => {
    mocks.remove.mockResolvedValue(['uploads/health-documents/u/a.pdf']);
    await removeEcgRecording(owner, recId, owner);
    expect(mocks.remove).toHaveBeenCalledWith(owner, recId, owner);
    expect(mocks.discard).toHaveBeenCalledWith(
      'uploads/health-documents/u/a.pdf'
    );
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.discard.mock.invocationCallOrder[0]!
    );
  });

  it('counts a recording already gone as deleted', async () => {
    mocks.remove.mockResolvedValue([]);
    await expect(removeEcgRecording(owner, recId)).resolves.toBeUndefined();
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it('does not fail when a file cannot be removed', async () => {
    mocks.remove.mockResolvedValue(['uploads/health-documents/u/a.pdf']);
    mocks.discard.mockRejectedValue(new Error('busy'));
    await expect(removeEcgRecording(owner, recId)).resolves.toBeUndefined();
  });
});
