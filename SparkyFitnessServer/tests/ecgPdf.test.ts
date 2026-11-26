import { describe, expect, it } from 'vitest';
import { parseEcgReport } from '@workspace/shared';
import { extractEcgPdf } from '../services/ecgPdf.js';

/**
 * End-to-end over a real PDF — built here, never a real one. A Garmin ECG
 * export is personal health data and is not committed to this repo, so these
 * tests reproduce the report's SHAPE: values above their labels in the same
 * column, an identifying block on the right of the same rows, a footer of
 * versions, and three ten-second strips drawn as vector polylines.
 */

import {
  HEIGHT,
  STRIP_W,
  STRIP_X0,
  UNITS_PER_MV,
  build,
  drawStrip,
  syntheticReport,
} from './fixtures/ecgReportPdf.js';

describe('extractEcgPdf', () => {
  it('lifts the text layer and the three waveform polylines out of a real PDF', async () => {
    const content = await extractEcgPdf(await syntheticReport());
    expect(content.items.length).toBeGreaterThan(30);
    expect(content.traces).toHaveLength(3);
    for (const t of content.traces) expect(t.length).toBe(250);
  }, 30_000);

  it('returns the trace in page space, where a positive deflection has the larger y', async () => {
    const content = await extractEcgPdf(await syntheticReport());
    const first = content.traces[0]!;
    const flat = first[0]!.y;
    const peak = Math.max(...first.map((p) => p.y));
    expect(peak - flat).toBeCloseTo(UNITS_PER_MV, 1); // the 1 mV spike, upward
  }, 30_000);

  it('reads a PDF with no text layer as no items rather than throwing', async () => {
    const buf = await build((doc) => {
      doc.rect(50, 50, 200, 100).stroke();
    });
    const content = await extractEcgPdf(buf);
    expect(content.items).toHaveLength(0);
    expect(parseEcgReport(content).ok).toBe(false);
  }, 30_000);

  it('rejects bytes that are not a PDF instead of hanging', async () => {
    await expect(
      extractEcgPdf(Buffer.from('not a pdf at all\n'))
    ).rejects.toBeDefined();
  }, 30_000);
});

describe('extractEcgPdf + parseEcgReport', () => {
  it('imports the whole report from the file, with nothing to type', async () => {
    const res = parseEcgReport(await extractEcgPdf(await syntheticReport()));
    expect(res.ok).toBe(true);
    const r = res.report!;
    expect(r.result).toBe('Sinus Rhythm');
    expect(r.avgHeartRateBpm).toBe(61);
    expect(r.symptoms).toBe('--');
    expect(r.interpretation).toBe(
      'This ECG recording does not show signs of AFib.'
    );
    expect(r.leadNote).toBe('This waveform is similar to a Lead I ECG.');
    expect(r.recordedAtLocal).toEqual({
      year: 2024,
      month: 6,
      day: 12,
      hour: 9,
      minute: 17,
    });
    expect(r.durationSec).toBe(30);
    expect(r.paperSpeedMmS).toBe(25);
    expect(r.gainMmMv).toBe(10);
    expect(r.sampleRateHz).toBe(512);
    expect(r.pdfTemplateVersion).toBe('1.2.114');
    expect(r.deviceModel).toBe('fenix 9 Pro - inReach, 43 mm');
    expect(r.deviceSoftware).toBe('6.38');
  }, 30_000);

  it('recovers the drawn trace: three strips, ten seconds apart, at the amplitudes drawn', async () => {
    const w = parseEcgReport(await extractEcgPdf(await syntheticReport()))
      .report!.waveform!;
    expect(w.strips.map((s) => s.t0Ms)).toEqual([0, 10000, 20000]);
    expect(w.durationMs).toBe(30000);
    expect(w.strips[0]!.uv[100]).toBeCloseTo(1000, -1);
    expect(w.strips[1]!.uv[50]).toBeCloseTo(500, -1);
    expect(w.strips[2]!.uv[150]).toBeCloseTo(-250, -1);
  }, 30_000);

  it('keeps the identifying block out of the record even when it is on the page', async () => {
    const res = parseEcgReport(await extractEcgPdf(await syntheticReport()));
    const { waveform: _drop, ...fields } = res.report!;
    const printed = JSON.stringify(fields);
    for (const pii of ['Jordan', 'Fixtureson', '1979', 'Female'])
      expect(printed).not.toContain(pii);
  }, 30_000);
});

describe('extractEcgPdf under a transform', () => {
  it('puts a strip drawn under its own scale and translate in page space', async () => {
    // The strip is drawn in half-size local units under translate + scale(0.5), so only the
    // tracked transform puts it back where it prints: x from STRIP_X0, 1 mV spike upward.
    const buf = await build((doc) => {
      doc.save().translate(STRIP_X0, 300).scale(0.5, 0.5);
      doc.lineWidth(0.8).strokeColor('#000');
      const points = 250;
      for (let i = 0; i < points; i++) {
        const x = (i * STRIP_W * 2) / (points - 1);
        const y = i === 100 ? -2 * UNITS_PER_MV : 0;
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      }
      doc.stroke().restore();
      // A second strip after the restore, untransformed: nothing may leak out of the first.
      drawStrip(doc, 400, 0, 0);
    });
    const { traces } = await extractEcgPdf(buf);
    expect(traces).toHaveLength(2);
    const [scaled, plain] = traces as [(typeof traces)[0], (typeof traces)[0]];
    expect(scaled![0]!.x).toBeCloseTo(STRIP_X0, 2);
    expect(scaled![scaled!.length - 1]!.x).toBeCloseTo(STRIP_X0 + STRIP_W, 1);
    // pdfkit's y is top-down: local y 0 under translate(.., 300) is page y HEIGHT - 300.
    expect(scaled![0]!.y).toBeCloseTo(HEIGHT - 300, 2);
    expect(scaled![100]!.y - scaled![0]!.y).toBeCloseTo(UNITS_PER_MV, 1);
    expect(plain![0]!.y).toBeCloseTo(HEIGHT - 400, 2);
    expect(plain![0]!.x).toBeCloseTo(STRIP_X0, 2);
  }, 30_000);

  it('reads the strips of the synthetic report at the sampling the file was drawn at', async () => {
    const w = parseEcgReport(await extractEcgPdf(await syntheticReport()))
      .report!.waveform!;
    expect(w.strips).toHaveLength(3);
    expect(w.droppedStrips).toBe(0);
  }, 30_000);
});
