import type { AppointmentReportData } from '@workspace/shared';
/** Public synthetic records only. Never populate this fixture from a real account. */
export function appointmentReportFixture(full = false): AppointmentReportData {
  const empty: AppointmentReportData = {
    generatedAt: '2026-11-15T12:30:00Z',
    ownerDisplayName: null,
    range: { from: '2026-08-17', to: '2026-11-15', timezone: 'Europe/London' },
    currentMedications: [],
    doseLog: [],
    symptoms: [],
    wellness: { weights: [], nutrition: [], water: [], mood: [] },
    labPanels: [],
  };
  if (!full) return empty;
  return {
    ...empty,
    ownerDisplayName: 'Synthetic Zoë Łukasz Δ Ж 中 😀',
    currentMedications: [
      {
        id: 'synthetic-med',
        name: 'Synthetic long medication name with diacritics: µ μ Zoë',
        doseAmount: '0.000123456789',
        doseUnit: 'µg',
        active: true,
        schedules: [
          {
            type: 'interval',
            timeOfDay: '08:30',
            daysOfWeek: [1, 3],
            intervalDays: 3,
            dayOfMonth: null,
            cycleOnDays: 5,
            cycleOffDays: 2,
            withMeal: 'with food',
            prnReason: 'Synthetic recorded reason',
            prnMaxPerDay: 0,
            doseAmount: '0',
            doseUnit: 'µg',
            startDate: '2026-08-17',
            endDate: null,
            active: true,
          },
        ],
        titration: [
          {
            doseAmount: '0.25',
            doseUnit: 'mg',
            startDate: '2026-11-01',
            plannedWeeks: 0,
            status: 'planned',
          },
        ],
      },
    ],
    doseLog: Array.from({ length: 34 }, (_, i) => ({
      id: `event-${i}`,
      sourceKind: i % 2 ? 'injection' : 'medication_entry',
      medicationId: 'synthetic-med',
      name: `Synthetic event ${String(i).padStart(2, '0')}: ${'a long recorded medication label with precise clinical text µ μ ≤ ≥ × 10⁹ − '.repeat(i === 4 ? 15 : 1)}`,
      nameBasis: i % 2 ? 'current_link' : 'snapshot',
      trackingDay: '2026-11-01',
      occurredAt: i === 2 ? null : '2026-11-01T12:00:00Z',
      scheduledFor: null,
      status: i === 2 ? 'skipped' : 'taken',
      administered: i !== 2,
      doseAmount: i === 3 ? '7' : '0.000123456789',
      doseUnit: i === 3 ? null : 'µg',
      deliveredMassMg: null,
      administrationRoute: i % 2 ? 'injection' : null,
      site: i % 2 ? 'left abdomen' : null,
    })),
    symptoms: Array.from({ length: 17 }, (_, i) => ({
      id: `symptom-${i}`,
      name: `Synthetic symptom ${i}`,
      trackingDay: '2026-11-01',
      loggedAt: null,
      severity: i === 0 ? 0 : null,
      severityLabel: null,
    })),
    wellness: {
      weights: [
        { day: '2026-09-01', value: 90, unit: 'kg' },
        { day: '2026-11-01', value: 88.5, unit: 'kg' },
      ],
      nutrition: [
        { day: '2026-11-01', calories: 0, proteinGrams: 0 },
        { day: '2026-11-02', calories: null, proteinGrams: null },
      ],
      water: [{ day: '2026-11-01', millilitres: 0 }],
      mood: [{ day: '2026-11-01', mood: 0, energy: 0 }],
    },
    labPanels: Array.from({ length: 3 }, (_, p) => ({
      id: `panel-${p}`,
      labName: 'Synthetic laboratory',
      collectedOn: `2026-0${9 - p}-01`,
      origin: p ? 'imported' : 'manual',
      results: Array.from({ length: 18 }, (_, i) => ({
        id: `lab-${p}-${i}`,
        markerId: `distinct-assay-${i}`,
        name: `Synthetic marker ${i} ${i === 1 ? '(distinct assay, not merged)' : ''}`,
        date: `2026-0${9 - p}-01`,
        valueNumeric: i === 0 ? 0 : null,
        valueText:
          i === 1
            ? '≤ 0.0100'
            : i === 2
              ? '≥ 2.50'
              : i === 3
                ? '< 0.02'
                : i === 4
                  ? '> 10'
                  : i === 5
                    ? 'Not detected'
                    : null,
        unit: i === 0 ? 'µmol/L' : '10⁹/L',
        referenceLow: i % 2 ? null : 0,
        referenceHigh: i % 2 ? 2.5 : null,
        rangeFlag: 'unknown',
        method: null,
      })),
    })),
  };
}
