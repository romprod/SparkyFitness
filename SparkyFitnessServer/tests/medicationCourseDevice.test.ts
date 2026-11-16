import { describe, expect, it } from 'vitest';
import type { MedicationSyringe } from '@workspace/shared';
import {
  courseDeviceChoice,
  resolveCourseDevice,
} from '../services/medicationCourseDeviceService.js';
const device: MedicationSyringe = {
  id: '00000000-0000-4000-a000-000000000001',
  name: 'Synthetic real syringe',
  device_type: 'syringe',
  graduation_type: 'units',
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
  is_default: false,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
};
describe('future forecast device binding', () => {
  it('omission preserves explicit missing provenance while null deliberately selects preferred', () => {
    const old = { device_id: null, device_choice: 'explicit' as const };
    expect(courseDeviceChoice({}, old)).toEqual(old);
    expect(courseDeviceChoice({ device_id: null }, old)).toEqual({
      device_id: null,
      device_choice: 'preferred',
    });
    expect(courseDeviceChoice({})).toEqual({
      device_id: null,
      device_choice: 'preferred',
    });
  });
  it('never replaces a deleted explicit device with a saved preferred device', () => {
    expect(
      resolveCourseDevice(
        { device_id: null, device_choice: 'explicit' },
        [device],
        device.id,
        'injection'
      ).binding
    ).toMatchObject({ choice: 'explicit', device_id: null, source: 'missing' });
  });
  it('resolves only real preferred and explicit devices with route-compatible metadata', () => {
    expect(
      resolveCourseDevice(
        { device_id: null, device_choice: 'preferred' },
        [device],
        device.id,
        'injection'
      ).binding
    ).toMatchObject({ device_id: device.id, source: 'preferred' });
    expect(
      resolveCourseDevice(
        { device_id: device.id, device_choice: 'explicit' },
        [device],
        null,
        'injection'
      ).binding.source
    ).toBe('plan');
    expect(
      resolveCourseDevice(
        { device_id: device.id, device_choice: 'explicit' },
        [device],
        null,
        'nasal'
      ).binding.source
    ).toBe('incompatible');
    expect(
      resolveCourseDevice(
        { device_id: null, device_choice: 'preferred' },
        [device],
        null,
        'injection'
      ).binding.source
    ).toBe('missing');
  });
});
