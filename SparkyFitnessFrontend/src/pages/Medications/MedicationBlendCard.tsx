import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import {
  BLEND_SOURCES,
  blendTotalMg,
  blendVialMismatches,
  medicationBlendInputSchema,
  weakestBlendSource,
  type BlendSource,
  type MedicationBlend,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  useMedicationBlends,
  useSaveMedicationBlendMutation,
} from '@/hooks/Medications/useMedicationBlends';
import { useMedicationPens } from '@/hooks/useMedications';

interface Row {
  component_medication_id: string;
  mass_mg: string;
  source: BlendSource;
}

const SOURCE_FALLBACK: Record<BlendSource, string> = {
  label: 'Label',
  coa: 'Certificate of analysis',
  assumed: 'Assumed',
};

const percent = (mass: string, total: string) => {
  const whole = Number(total);
  const part = Number(mass);
  return whole > 0 && part > 0
    ? `${Math.round((part / whole) * 1000) / 10}%`
    : null;
};

const rowsOf = (blend: MedicationBlend | undefined): Row[] =>
  (blend?.components ?? []).map((component) => ({
    component_medication_id: component.component_medication_id,
    mass_mg: component.mass_mg,
    source: component.source,
  }));

/**
 * Pitstop's blend-mass warning: advisory only, never blocks a save. In Sparky the "vial label" is
 * each stock vial's printed mass (`label_mass_mg`); the medicine's own strength is not used as a
 * default vial label, so it is not compared.
 */
function VialLabelWarning({
  components,
  vials,
}: {
  components: Parameters<typeof blendVialMismatches>[0];
  vials: Parameters<typeof blendVialMismatches>[1];
}) {
  const { t } = useTranslation();
  const mismatches = blendVialMismatches(components, vials);
  if (mismatches.length === 0) return null;
  return (
    <div role="status" className="space-y-1 text-xs text-amber-600">
      {mismatches.map((mismatch) => (
        <p key={mismatch.expected_mg}>
          {t(
            'medications.blends.vialMismatch',
            'Components total {{sum}} mg but the vial label says {{expected}} mg — derived figures will scale off {{sum}} mg.',
            { sum: mismatch.sum_mg, expected: mismatch.expected_mg }
          )}
          {mismatch.vials.length > 0 && ` (${mismatch.vials.join(', ')})`}
        </p>
      ))}
    </div>
  );
}

/**
 * What a vendor blend is made of, as Pitstop's blend editor has it: the compounds one labelled
 * vial holds and the mg of each. Doses are still logged as the whole blend; what each compound
 * received is worked out from these masses and always shown as derived.
 */
export default function MedicationBlendCard({
  medication,
  candidates,
}: {
  medication: { id: string; name: string };
  /** The owner's other medications that can be components. */
  candidates: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const { data: blends, query } = useMedicationBlends();
  const save = useSaveMedicationBlendMutation();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pensQ = useMedicationPens(medication.id);

  if (query.isLoading || query.isError || !blends) return null;
  const blend = blends.find((b) => b.blend_medication_id === medication.id);
  const parents = blends.filter((b) =>
    b.components.some((c) => c.component_medication_id === medication.id)
  );
  const blendIds = new Set(blends.map((b) => b.blend_medication_id));
  const chooseFrom = candidates.filter(
    (candidate) => candidate.id !== medication.id && !blendIds.has(candidate.id)
  );
  const sourceLabel = (source: BlendSource) =>
    t(`medications.blends.source.${source}`, SOURCE_FALLBACK[source]);

  const editing = rows !== null;
  const total = blend ? blendTotalMg(blend.components) : '0';
  const draftComponents = (rows ?? []).map((row, index) => ({
    component_medication_id: row.component_medication_id,
    name: '',
    mass_mg: row.mass_mg,
    source: row.source,
    sort_index: index,
  }));
  const draftTotal = blendTotalMg(draftComponents);
  const vials = pensQ.data ?? [];

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) =>
      (current ?? []).map((row, i) =>
        i === index ? { ...row, ...patch } : row
      )
    );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const filled = (rows ?? []).filter(
      (row) => row.component_medication_id || row.mass_mg.trim()
    );
    if (
      filled.some((row) => !row.component_medication_id || !row.mass_mg.trim())
    )
      return void setError(
        t(
          'medications.blends.incomplete',
          'Choose a compound and a mass for every row.'
        )
      );
    const parsed = medicationBlendInputSchema.safeParse({
      components: filled,
    });
    if (!parsed.success)
      return void setError(
        parsed.error.issues[0]?.message ??
          t('medications.blends.invalid', 'Check the components and try again.')
      );
    try {
      await save.mutateAsync({ id: medication.id, body: parsed.data });
      setRows(null);
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t(
              'medications.blends.saveFailed',
              'Could not save the components. Please try again.'
            )
      );
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-primary" />
          {t('medications.blends.title', 'Blend components')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t(
            'medications.blends.intro',
            'For one vial that holds several compounds. Log doses of the blend as a whole; what each compound received is worked out from these masses and always shown as derived.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {parents.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t(
              'medications.blends.componentOf',
              'This is a component of {{blends}}, so it cannot have components of its own.',
              { blends: parents.map((parent) => parent.name).join(', ') }
            )}
          </p>
        )}

        {parents.length === 0 && !editing && (
          <>
            {blend ? (
              <>
                <ul className="space-y-1">
                  {blend.components.map((component) => (
                    <li
                      key={component.component_medication_id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3"
                    >
                      <span className="font-medium">{component.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {component.mass_mg} mg
                        {percent(component.mass_mg, total) &&
                          ` · ${percent(component.mass_mg, total)}`}{' '}
                        · {sourceLabel(component.source)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'medications.blends.vialTotal',
                    'One labelled vial: {{total}} mg. Ratio source: {{source}}.',
                    {
                      total,
                      source: sourceLabel(weakestBlendSource(blend.components)),
                    }
                  )}
                </p>
                <VialLabelWarning components={blend.components} vials={vials} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('medications.blends.none', 'Not a blend.')}
              </p>
            )}
            {saved && (
              <p role="status" className="text-xs text-muted-foreground">
                {t('medications.blends.saved', 'Components saved.')}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSaved(false);
                setError(null);
                setRows(
                  blend
                    ? rowsOf(blend)
                    : [
                        {
                          component_medication_id: '',
                          mass_mg: '',
                          source: 'label',
                        },
                      ]
                );
              }}
            >
              {blend
                ? t('medications.blends.edit', 'Edit components')
                : t('medications.blends.add', 'Add components')}
            </Button>
          </>
        )}

        {parents.length === 0 && editing && (
          <form
            onSubmit={submit}
            className="space-y-3"
            aria-label={t('medications.blends.formLabel', 'Blend components')}
          >
            {chooseFrom.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.blends.noCandidates',
                  'Add each compound as a medication first, then choose it here.'
                )}
              </p>
            )}
            <ul className="space-y-2">
              {rows.map((row, index) => (
                <li
                  key={index}
                  className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_7rem_9rem_auto]"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor={`blend-component-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('medications.blends.component', 'Component')}
                    </label>
                    <select
                      id={`blend-component-${index}`}
                      value={row.component_medication_id}
                      onChange={(event) =>
                        update(index, {
                          component_medication_id: event.target.value,
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">
                        {t('medications.blends.choose', '— choose —')}
                      </option>
                      {chooseFrom.map((candidate) => (
                        <option
                          key={candidate.id}
                          value={candidate.id}
                          disabled={rows.some(
                            (other, i) =>
                              i !== index &&
                              other.component_medication_id === candidate.id
                          )}
                        >
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`blend-mass-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('medications.blends.mass', 'mg in one vial')}
                    </label>
                    <Input
                      id={`blend-mass-${index}`}
                      inputMode="decimal"
                      value={row.mass_mg}
                      onChange={(event) =>
                        update(index, { mass_mg: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`blend-source-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      {t('medications.blends.sourceField', 'Ratio source')}
                    </label>
                    <select
                      id={`blend-source-${index}`}
                      value={row.source}
                      onChange={(event) =>
                        update(index, {
                          source: event.target.value as BlendSource,
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {BLEND_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {sourceLabel(source)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pb-1.5">
                    <span className="min-w-10 text-right text-xs tabular-nums text-muted-foreground">
                      {percent(row.mass_mg, draftTotal)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={t(
                        'medications.blends.remove',
                        'Remove component'
                      )}
                      onClick={() =>
                        setRows((current) =>
                          (current ?? []).filter((_, i) => i !== index)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setRows((current) => [
                    ...(current ?? []),
                    {
                      component_medication_id: '',
                      mass_mg: '',
                      source: 'label',
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('medications.blends.addRow', 'Add component')}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t('medications.blends.draftTotal', 'Total {{total}} mg', {
                  total: draftTotal,
                })}
              </span>
            </div>
            <VialLabelWarning components={draftComponents} vials={vials} />
            {rows.length === 0 && blend && (
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.blends.clearHint',
                  'Saving with no components makes this a plain medication again.'
                )}
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending}>
                {t('medications.blends.save', 'Save components')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows(null);
                  setError(null);
                }}
              >
                {t('medications.blends.cancel', 'Cancel')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.blends.note',
                'Masses are for one labelled vial. Everything worked out from them is shown as derived, never as a measured dose.'
              )}
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
