/** Private, ephemeral appointment export. Values are recorded facts, without clinical interpretation. */
export interface AppointmentReportData {
  generatedAt: string;
  ownerDisplayName: string | null;
  range: { from: string; to: string; timezone: string };
  /** Current facts at export time, not historical prescriptions for the selected range. */
  currentMedications: {
    id: string;
    name: string;
    doseAmount: string | null;
    doseUnit: string | null;
    active: boolean;
    schedules: {
      type: string;
      timeOfDay: string | null;
      daysOfWeek: number[] | null;
      intervalDays: number | null;
      dayOfMonth: number | null;
      cycleOnDays: number | null;
      cycleOffDays: number | null;
      withMeal: string | null;
      prnReason: string | null;
      prnMaxPerDay: number | null;
      doseAmount: string | null;
      doseUnit: string | null;
      startDate: string | null;
      endDate: string | null;
      active: boolean;
    }[];
    titration: {
      doseAmount: string | null;
      doseUnit: string | null;
      startDate: string | null;
      plannedWeeks: number | null;
      status: string;
    }[];
  }[];
  /** Explicit authored managed revisions, labelled separately from current legacy plans. */
  managedPlans?: {
    courseId: string;
    revisionId: string;
    revisionNo: number;
    medicationId: string | null;
    medicationName: string;
    timezone: string;
    name: string;
    current: boolean;
    status: 'active' | 'paused' | 'completed';
    deleted: boolean;
    startDate: string | null;
    endDate: string | null;
    closedDate: string | null;
    targetDose: string | null;
    doseUnit: string;
    doseBasis: 'per_injection' | 'per_week';
    schedules: AppointmentReportData['currentMedications'][number]['schedules'];
    steps: {
      doseAmount: string;
      doseUnit: string;
      durationDays: number | null;
    }[];
    activity: { fromAt: string; untilAt: string | null }[];
  }[];
  /** Independently read ordinary entries and actual injections, merged exactly once. */
  doseLog: {
    id: string;
    sourceKind: 'medication_entry' | 'injection';
    medicationId: string | null;
    name: string | null;
    nameBasis: 'snapshot' | 'current_link' | 'unknown';
    trackingDay: string;
    occurredAt: string | null;
    scheduledFor: string | null;
    /** Rounded actual minus scheduled minutes from explicit recorded instants; negative is early. */
    timingDeltaMinutes: number | null;
    status: string;
    administered: boolean;
    doseAmount: string | null;
    doseUnit: string | null;
    deliveredMassMg: string | null;
    administrationRoute: string | null;
    site: string | null;
  }[];
  symptoms: {
    id: string;
    name: string;
    trackingDay: string;
    loggedAt: string | null;
    severity: number | null;
    severityLabel: string | null;
  }[];
  wellness: {
    /** Positive saved target in effect at generation time, never a historical range assumption or default. */
    hydrationTargetMl: number | null;
    weights: { day: string; value: number; unit: 'kg' }[];
    nutrition: {
      day: string;
      calories: number | null;
      proteinGrams: number | null;
    }[];
    water: { day: string; millilitres: number | null }[];
    mood: { day: string; mood: number | null; energy: number | null }[];
  };
  /** Latest three explicit manual/imported panels, irrespective of the selected range. */
  labPanels: {
    id: string;
    labName: string | null;
    collectedOn: string | null;
    origin: 'manual' | 'imported';
    results: {
      id: string;
      markerId: string;
      name: string;
      date: string;
      valueNumeric: number | null;
      valueText: string | null;
      unit: string;
      referenceLow: number | null;
      referenceHigh: number | null;
      rangeFlag: 'low' | 'high' | 'normal' | 'unknown';
      /** No assay-method column exists in the current stored lab-result schema. */
      method: null;
    }[];
  }[];
}
