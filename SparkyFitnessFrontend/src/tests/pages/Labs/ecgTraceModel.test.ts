import {
  MAX_HALF_MM,
  MIN_HALF_MM,
  amplitudeHalfMm,
  buildTraceModel,
  resolveScale,
  rowGeometry,
  secondsLabel,
  stripPath,
} from '@/pages/Labs/ecgTraceModel';

describe('stripPath', () => {
  it('draws one continuous line when there are no holes', () => {
    // 8 ms apart at 25 mm/s is 0.2 mm; 1000 uV at 10 mm/mV is 10 mm up (negative y).
    expect(stripPath([0, 1000, 0], 8, 25, 10, 2)).toBe(
      'M2.00 0.00L2.20 -10.00L2.40 0.00'
    );
  });

  it('breaks the line at a null instead of bridging it', () => {
    const d = stripPath([0, 500, null, null, 500, 0], 8, 25, 10, 0);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(2);
    expect(d).toBe('M0.00 0.00L0.20 -5.00M0.80 -5.00L1.00 0.00');
  });

  it('is empty when every sample is a hole', () => {
    expect(stripPath([null, null], 8, 25, 10, 0)).toBe('');
  });
});

describe('rowGeometry', () => {
  it('lays strips on one scale, each starting at its offset into the row', () => {
    const samples = (n: number) => Array.from({ length: n }, () => 0);
    // Two 10 s strips at 8 ms (1251 samples = 10 000 ms), the second starting at 10 s.
    const g = rowGeometry(
      [
        { t0Ms: 0, dtMs: 8, uv: samples(1251) },
        { t0Ms: 10000, dtMs: 8, uv: samples(1251) },
      ],
      25
    );
    expect(g.spans).toEqual([10000, 10000]);
    expect(g.leads).toEqual([0, 0]);
    expect(g.widthMm).toBe(250);
  });

  it('keeps a late start late within its row', () => {
    const g = rowGeometry(
      [
        { t0Ms: 0, dtMs: 10, uv: new Array(1001).fill(0) },
        { t0Ms: 12000, dtMs: 10, uv: new Array(501).fill(0) },
      ],
      25
    );
    // Row is 10 s; 12 000 ms is 2 s into the second row, and it runs 5 s from there.
    expect(g.leads).toEqual([0, 2000]);
    expect(g.widthMm).toBe(10 * 25);
  });

  it('never gives a zero or negative width', () => {
    expect(rowGeometry([{ t0Ms: 0, dtMs: 8, uv: [0] }], 25).widthMm).toBe(1);
  });
});

describe('resolveScale', () => {
  it('falls back to 25 mm/s and 10 mm/mV when the report printed none', () => {
    expect(resolveScale(null, undefined)).toEqual({ speed: 25, gain: 10 });
    expect(resolveScale(0, -3)).toEqual({ speed: 25, gain: 10 });
  });
  it('uses what the report printed', () => {
    expect(resolveScale(50, 20)).toEqual({ speed: 50, gain: 20 });
  });
});

describe('amplitudeHalfMm', () => {
  it('rounds up to a whole big square and clamps to the window', () => {
    expect(amplitudeHalfMm(0, 10)).toBe(MIN_HALF_MM);
    expect(amplitudeHalfMm(1, 10)).toBe(15); // ceil(12 / 5) * 5
    expect(amplitudeHalfMm(50, 10)).toBe(MAX_HALF_MM);
  });
});

describe('buildTraceModel', () => {
  it('is null when nothing was drawn', () => {
    expect(buildTraceModel({ strips: [] }, 25, 10)).toBeNull();
    expect(
      buildTraceModel(
        { strips: [{ t0Ms: 0, dtMs: 8, uv: [null, null] }] },
        25,
        10
      )
    ).toBeNull();
  });

  it('uses the fallback scale and builds a path per strip', () => {
    const model = buildTraceModel(
      { strips: [{ t0Ms: 0, dtMs: 1000, uv: [0, 1000, null, 0] }] },
      null,
      null
    );
    expect(model).not.toBeNull();
    expect(model!.speed).toBe(25);
    expect(model!.gain).toBe(10);
    expect(model!.halfMm).toBe(15);
    expect(model!.heightMm).toBe(30);
    expect(model!.strips[0]!.path).toContain('M');
    expect(model!.strips[0]!.endMs).toBe(3000);
  });
});

describe('secondsLabel', () => {
  it('prints whole seconds plainly and others to a tenth', () => {
    expect(secondsLabel(10000)).toBe('10s');
    expect(secondsLabel(2500)).toBe('2.5s');
  });
});
