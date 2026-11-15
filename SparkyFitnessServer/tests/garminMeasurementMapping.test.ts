import { afterEach, describe, expect, it, vi } from 'vitest';
import garminMeasurementMapping, {
  parseGarminHealthMeasurements,
} from '../integrations/garminconnect/garminMeasurementMapping.js';

describe('Garmin daily calorie measurement mapping', () => {
  it('routes active calories through the deduplicated Active Calories path', () => {
    expect(garminMeasurementMapping.active_calories).toEqual({
      targetType: 'custom',
      name: 'Active Calories',
      dataType: 'numeric',
      measurementType: 'kcal',
      frequency: 'Daily',
    });
  });

  it('stores Garmin resting calories as check-in BMR', () => {
    expect(garminMeasurementMapping.bmr_calories).toEqual({
      targetType: 'check_in',
      field: 'bmr',
      dataType: 'numeric',
      measurementType: 'kcal',
    });
  });

  it('stores Garmin total calories as a reportable daily measurement', () => {
    expect(garminMeasurementMapping.total_calories).toEqual({
      targetType: 'custom',
      name: 'total_calories',
      dataType: 'numeric',
      measurementType: 'kcal',
      frequency: 'Daily',
    });
  });
});

describe('parseGarminHealthMeasurements', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('can disable Garmin weight while retaining all other measurements', () => {
    vi.stubEnv('SPARKY_FITNESS_GARMIN_SYNC_WEIGHT', 'false');
    const parsed = parseGarminHealthMeasurements({
      body_composition: [
        { date: '2026-11-12', weight: 83, body_fat_percentage: 18 },
      ],
      steps: [{ date: '2026-11-12', value: 1234 }],
    });
    expect(parsed.map((x) => x.type)).toEqual(['body_fat_percentage', 'steps']);
  });

  it('keeps the existing weight import unless explicitly disabled', () => {
    vi.stubEnv('SPARKY_FITNESS_GARMIN_SYNC_WEIGHT', 'true');
    const parsed = parseGarminHealthMeasurements({
      weight: [{ date: '2026-11-12', value: 83 }],
    });
    expect(parsed[0]).toMatchObject({ type: 'weight', value: 83 });
  });
  it('ignores zero values for water, weight, and body_fat_percentage', () => {
    const rawData = {
      hydration: [{ date: '2026-09-14', hydration: 0 }],
      body_composition: [
        {
          date: '2026-09-14',
          weight: 0,
          body_fat_percentage: 0,
          muscle_mass: 45.2,
        },
      ],
    };

    const parsed = parseGarminHealthMeasurements(rawData);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      type: 'muscle_mass_kg',
      value: 45.2,
      date: '2026-09-14',
      source: 'garmin',
      dataType: 'numeric',
      measurementType: 'kg',
    });
  });

  it('parses positive hydration values correctly', () => {
    const rawData = {
      hydration: [{ date: '2026-09-14', hydration: 750 }],
    };

    const parsed = parseGarminHealthMeasurements(rawData);
    expect(parsed).toEqual([
      {
        type: 'water',
        value: 750,
        date: '2026-09-14',
        source: 'garmin',
        dataType: 'numeric',
        measurementType: 'ml',
      },
    ]);
  });
});
