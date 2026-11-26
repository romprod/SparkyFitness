import { describe, expect, it } from 'vitest';
import {
  medicationMatchesName,
  parseAliases,
  readAliases,
  readStorageNotes,
  readSubstanceClass,
  withMedicineProfile,
} from '@workspace/shared';

describe('parseAliases', () => {
  it('splits on commas, trims, drops blanks and case-insensitive duplicates', () => {
    expect(
      parseAliases(' BPC-157 , bpc157,, BPC-157,Body Protection ')
    ).toEqual(['BPC-157', 'bpc157', 'Body Protection']);
    expect(parseAliases('  ,  ')).toEqual([]);
  });
  it('caps the count at 20 and each alias at 100 characters', () => {
    const many = Array.from({ length: 30 }, (_, i) => `a${i}`).join(',');
    expect(parseAliases(many)).toHaveLength(20);
    expect(parseAliases('x'.repeat(150))[0]).toHaveLength(100);
  });
});

describe('readers', () => {
  it('reads aliases, ignoring junk', () => {
    expect(readAliases({ aliases: ['A', ' a ', 3, '', 'B'] })).toEqual([
      'A',
      'B',
    ]);
    expect(readAliases({ aliases: 'A' })).toEqual([]);
    expect(readAliases(null)).toEqual([]);
  });
  it('reads storage notes trimmed, capped, null when blank', () => {
    expect(readStorageNotes({ storage_notes: '  Fridge ' })).toBe('Fridge');
    expect(readStorageNotes({ storage_notes: '   ' })).toBeNull();
    expect(readStorageNotes({ storage_notes: 5 })).toBeNull();
    expect(readStorageNotes({ storage_notes: 'n'.repeat(600) })?.length).toBe(
      500
    );
  });
  it('defaults the substance class to mass', () => {
    expect(readSubstanceClass(undefined)).toBe('mass');
    expect(readSubstanceClass({ substance_class: 'IU' })).toBe('IU');
    expect(readSubstanceClass({ substance_class: 'other' })).toBe('mass');
  });
});

describe('withMedicineProfile', () => {
  it('sets keys and keeps every other key', () => {
    expect(
      withMedicineProfile(
        { half_life_hours: 4 },
        { aliases: ['A'], storageNotes: ' Cold ', substanceClass: 'IU' }
      )
    ).toEqual({
      half_life_hours: 4,
      aliases: ['A'],
      storage_notes: 'Cold',
      substance_class: 'IU',
    });
  });
  it('removes keys when cleared or mass', () => {
    expect(
      withMedicineProfile(
        { aliases: ['A'], storage_notes: 'x', substance_class: 'IU', keep: 1 },
        { aliases: [], storageNotes: '  ', substanceClass: 'mass' }
      )
    ).toEqual({ keep: 1 });
  });
});

describe('medicationMatchesName', () => {
  const med = {
    name: 'Retatrutide',
    display_name: 'Reta',
    custom_fields: { aliases: ['LY3437943'] },
  };
  it('matches name, display name or alias, whole string, any case', () => {
    expect(medicationMatchesName(med, 'retatrutide')).toBe(true);
    expect(medicationMatchesName(med, ' RETA ')).toBe(true);
    expect(medicationMatchesName(med, 'ly3437943')).toBe(true);
  });
  it('does not match partials or blanks', () => {
    expect(medicationMatchesName(med, 'LY34')).toBe(false);
    expect(medicationMatchesName(med, '')).toBe(false);
    expect(medicationMatchesName({ name: null }, 'x')).toBe(false);
  });
});
