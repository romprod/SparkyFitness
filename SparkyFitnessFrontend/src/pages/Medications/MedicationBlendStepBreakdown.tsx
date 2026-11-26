import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildBlendStepBreakdown,
  type BlendSource,
  type MedicationCoursePlanInput,
} from '@workspace/shared';
import { useMedicationBlends } from '@/hooks/Medications/useMedicationBlends';
import { useMedicationPens } from '@/hooks/useMedications';
import {
  buildRampPlan,
  type Rules,
  type Steps,
} from './medicationCourseRampPlan';

const SOURCE_FALLBACK: Record<BlendSource, string> = {
  label: 'Label',
  coa: 'Certificate of analysis',
  assumed: 'Assumed',
};

/**
 * Pitstop's "Blend components across the ladder": how each component's per-administration mass
 * moves across the phases of a plan. Phase doses come from `buildRampPlan`, which already turns
 * a per-week phase into a per-administration one. Every figure is derived from the vendor ratio
 * and says so; nothing here is a measured dose. Renders nothing for a medicine that is not a blend.
 */
export default function MedicationBlendStepBreakdown({
  medicationId,
  medicationName,
  steps,
  rules,
  doseBasis,
  startDate,
  endDate,
  today,
}: {
  medicationId: string;
  medicationName: string;
  steps: Steps;
  rules: Rules;
  doseBasis: MedicationCoursePlanInput['dose_basis'];
  startDate: string | null;
  endDate: string | null;
  today: string;
}) {
  const { t } = useTranslation();
  const { data: blends } = useMedicationBlends();
  const pensQ = useMedicationPens(medicationId);
  const blend = blends?.find((b) => b.blend_medication_id === medicationId);
  const plan = useMemo(
    () => buildRampPlan({ steps, rules, doseBasis, startDate, endDate, today }),
    [steps, rules, doseBasis, startDate, endDate, today]
  );
  // The vial in use gives the concentration that turns mL into mg; otherwise mL cells stay dashes.
  const concentration = useMemo(() => {
    const inUse = (pensQ.data ?? [])
      .filter(
        (pen) =>
          pen.status === 'in_use' &&
          pen.concentration_mg_ml != null &&
          pen.concentration_mg_ml > 0
      )
      .sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''));
    return inUse[0]?.concentration_mg_ml ?? null;
  }, [pensQ.data]);

  if (!blend || !plan.ok) return null;
  const data = buildBlendStepBreakdown({
    steps: plan.phases.map((phase) => ({
      dose: phase.dose,
      unit: phase.unit,
      duration_days: phase.days,
    })),
    components: blend.components,
    concentrationMgPerMl: concentration,
  });
  if (!data) return null;

  return (
    <section
      className="space-y-2 rounded-md border p-3"
      aria-label={t(
        'medications.blends.ladderTitle',
        'Blend components across the ladder'
      )}
    >
      <h5 className="text-sm font-medium">
        {t(
          'medications.blends.ladderTitle',
          'Blend components across the ladder'
        )}
      </h5>
      <div className="overflow-x-auto">
        <p className="mb-1 text-xs font-medium">
          {t('medications.blends.ladderTable', 'Per-component breakdown')}
        </p>
        <table className="w-full whitespace-nowrap text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-normal">
                {t('medications.blends.ladderStep', 'Step')}
              </th>
              <th className="py-1 pr-3 font-normal">
                {t('medications.blends.ladderDose', 'Blend dose')}
              </th>
              {data.component_names.map((name, index) => (
                <th key={index} className="py-1 pr-3 font-normal">
                  {name} (mcg)
                </th>
              ))}
              <th className="py-1 font-normal">
                {t('medications.blends.ladderDuration', 'Duration')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.number} className="border-t">
                <td className="py-1 pr-3 text-muted-foreground">
                  {row.number}
                </td>
                <td className="py-1 pr-3">{row.dose_label}</td>
                {row.component_mcg.map((mcg, index) => (
                  <td key={index} className="py-1 pr-3">
                    {mcg === null ? '—' : mcg}
                  </td>
                ))}
                <td className="py-1 text-muted-foreground">
                  {row.duration_days === null
                    ? t('medications.blends.ladderMaintenance', 'maintenance')
                    : t('medications.blends.ladderDays', '{{days}} d', {
                        days: row.duration_days,
                      })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t(
          'medications.blends.ladderCaption',
          'Component masses are derived from the {{name}} vendor ratio ({{source}}); the blend is one vial — components are not dosed separately.',
          {
            name: medicationName,
            source: t(
              `medications.blends.source.${data.source}`,
              SOURCE_FALLBACK[data.source]
            ),
          }
        )}
      </p>
    </section>
  );
}
