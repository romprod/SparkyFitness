import { describe, expect, it } from 'vitest';
import {
  detectHealthDocumentType,
  healthDocumentFieldsSchema,
} from '@workspace/shared';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));

describe('what a file really is', () => {
  it('reads a PDF, JPEG, PNG, GIF and WebP from their first bytes', () => {
    expect(detectHealthDocumentType(ascii('%PDF-1.7\n'))).toEqual({
      mime: 'application/pdf',
      ext: 'pdf',
    });
    expect(detectHealthDocumentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(
      detectHealthDocumentType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)
      )
    ).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectHealthDocumentType(ascii('GIF89a'))).toEqual({
      mime: 'image/gif',
      ext: 'gif',
    });
    expect(detectHealthDocumentType(ascii('RIFF\0\0\0\0WEBPVP8 '))).toEqual({
      mime: 'image/webp',
      ext: 'webp',
    });
  });

  it('refuses anything else, whatever it is called, including other RIFF files and scripts', () => {
    expect(detectHealthDocumentType(ascii('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(detectHealthDocumentType(ascii('<html><script>'))).toBeNull();
    expect(detectHealthDocumentType(ascii('MZ\x90\0'))).toBeNull();
    expect(detectHealthDocumentType(ascii('PK\x03\x04'))).toBeNull();
    expect(detectHealthDocumentType(ascii(' %PDF-1.4'))).toBeNull();
    expect(detectHealthDocumentType(ascii('%PDF'))).toBeNull();
    expect(detectHealthDocumentType(new Uint8Array())).toBeNull();
  });
});

describe('what goes with the file', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it('reads a form that arrives as text, blank meaning not given', () => {
    expect(
      healthDocumentFieldsSchema.parse({
        kind: 'dexa_report',
        label: '  Nov scan  ',
        document_day: '2026-11-02',
        body_comp_scan_id: id(1),
        metabolic_test_id: '',
      })
    ).toEqual({
      kind: 'dexa_report',
      label: 'Nov scan',
      document_day: '2026-11-02',
      body_comp_scan_id: id(1),
      metabolic_test_id: null,
      ecg_recording_id: null,
    });
    expect(
      healthDocumentFieldsSchema.parse({
        kind: 'other',
        label: '',
        document_day: '',
      })
    ).toEqual({
      kind: 'other',
      label: null,
      document_day: null,
      body_comp_scan_id: null,
      metabolic_test_id: null,
      ecg_recording_id: null,
    });
  });

  it('refuses a kind it does not know, a bad date or id, a long label, and two links at once', () => {
    const bad = (patch: Record<string, unknown>) =>
      healthDocumentFieldsSchema.safeParse({ kind: 'other', ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ kind: 'xray' })).toBe(false);
    expect(bad({ document_day: '2026-02-31' })).toBe(false);
    expect(bad({ body_comp_scan_id: 'not-an-id' })).toBe(false);
    expect(bad({ label: 'x'.repeat(101) })).toBe(false);
    expect(bad({ body_comp_scan_id: id(1), metabolic_test_id: id(2) })).toBe(
      false
    );
    expect(bad({ kind: 'ecg_report', ecg_recording_id: id(3) })).toBe(true);
    expect(bad({ metabolic_test_id: id(2), ecg_recording_id: id(3) })).toBe(
      false
    );
    expect(bad({ ecg_recording_id: 'not-an-id' })).toBe(false);
    expect(healthDocumentFieldsSchema.safeParse({}).success).toBe(false);
  });
});
