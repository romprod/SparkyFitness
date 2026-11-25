import {
  medicationStackSetupInputSchema,
  stackComponentAmounts,
  type MedicationStackSetupInput,
  type MedicationStackSetupRequest,
  type StackConcentrationUnit,
  type StackDoseUnit,
} from '@workspace/shared';

/** The wizard's form state: everything is text until it is checked. */
export interface RampRowDraft {
  key: string;
  dose: string;
  unit: StackDoseUnit;
  /** Blank on the last phase keeps it going until the plan is changed. */
  days: string;
}
export interface ComponentDraft {
  key: string;
  name: string;
  concentration: string;
  concentrationUnit: StackConcentrationUnit;
  vialVolume: string;
  quantity: string;
  doseVolume: string;
  /** null until "+ Titration ramp" is used. */
  ramp: RampRowDraft[] | null;
}
export interface SetupDraft {
  name: string;
  notes: string;
  startDate: string;
  timeOfDay: string;
  components: ComponentDraft[];
}

/** Pitstop's defaults: a 5 mL vial, one vial, a 0.2 mL dose. */
export const newComponent = (key: string): ComponentDraft => ({
  key,
  name: '',
  concentration: '',
  concentrationUnit: 'mcg/ml',
  vialVolume: '5',
  quantity: '1',
  doseVolume: '0.2',
  ramp: null,
});
export const newRampRow = (key: string): RampRowDraft => ({
  key,
  dose: '',
  unit: 'mcg',
  days: '',
});
export const emptyDraft = (componentKey: string): SetupDraft => ({
  name: '',
  notes: '',
  startDate: '',
  timeOfDay: '',
  components: [newComponent(componentKey)],
});

export interface ComponentPreview {
  /** The dose volume as typed, for example "0.2". */
  volume: string;
  /** "500 mcg" or "1 mg": the mass of one dose. */
  dose: string;
  /** "25 mg": the mass of one whole vial. */
  vial: string;
}

/** The live line under a row, from the shared decimal helper; null until the row can be computed. */
export function componentPreview(
  component: ComponentDraft
): ComponentPreview | null {
  const amounts = stackComponentAmounts(
    {
      concentration_value: component.concentration,
      concentration_unit: component.concentrationUnit,
      vial_volume_ml: component.vialVolume,
      dose_volume_ml: component.doseVolume,
    },
    4
  );
  return amounts
    ? {
        volume: component.doseVolume.trim(),
        dose: `${amounts.dose.value} ${amounts.dose.unit}`,
        vial: `${amounts.vial.value} ${amounts.vial.unit}`,
      }
    : null;
}

const number = (text: string) => (text.trim() === '' ? NaN : Number(text));

export function buildSetupRequest(
  draft: SetupDraft,
  operationId: string
): MedicationStackSetupRequest {
  return {
    operation_id: operationId,
    name: draft.name,
    notes: draft.notes,
    start_date: draft.startDate || undefined,
    time_of_day: draft.timeOfDay || undefined,
    components: draft.components.map((component) => ({
      medication_name: component.name,
      concentration_value: number(component.concentration),
      concentration_unit: component.concentrationUnit,
      vial_volume_ml: number(component.vialVolume),
      quantity: number(component.quantity),
      dose_volume_ml: number(component.doseVolume),
      ...(component.ramp?.length
        ? {
            steps: component.ramp.map((row) => ({
              dose: row.dose.trim(),
              dose_unit: row.unit,
              duration_days: row.days.trim() === '' ? null : number(row.days),
            })),
          }
        : {}),
    })),
  };
}

export type SetupCheck =
  | { ok: true; data: MedicationStackSetupInput }
  | {
      ok: false;
      message: string;
      /** Set when the dialog should show its own translated text instead of `message`. */
      code?: 'rampOpenEnded';
    };

/** Checks the form with the same schema the server uses, so the wording is Pitstop's. */
export function checkSetup(draft: SetupDraft, operationId: string): SetupCheck {
  for (const component of draft.components)
    if (
      component.ramp?.some(
        (row, index, rows) => row.days.trim() === '' && index < rows.length - 1
      )
    )
      return { ok: false, message: '', code: 'rampOpenEnded' };
  const parsed = medicationStackSetupInputSchema.safeParse(
    buildSetupRequest(draft, operationId)
  );
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? '' };
}
