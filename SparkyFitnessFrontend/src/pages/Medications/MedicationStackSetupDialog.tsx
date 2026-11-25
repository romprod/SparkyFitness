import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type {
  MedicationStackSetupInput,
  StackConcentrationUnit,
  StackDoseUnit,
} from '@workspace/shared';
import { MAX_STACK_SETUP_COMPONENTS } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMedications } from '@/hooks/useMedications';
import { useSetupStackMutation } from '@/hooks/Medications/useMedicationStacks';
import {
  checkSetup,
  componentPreview,
  emptyDraft,
  newComponent,
  newRampRow,
  type ComponentDraft,
  type SetupDraft,
} from './medicationStackSetup';

let keyCounter = 0;
const nextKey = () => `k${keyCounter++}`;

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm';

/**
 * Set up compounded vials that come premixed and are taken together: one row a
 * component, with a live dose line and an optional titration ramp, then a
 * summary of what will be created before anything is saved.
 */
export default function MedicationStackSetupDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const medsQuery = useMedications();
  const setup = useSetupStackMutation();
  const [draft, setDraft] = useState<SetupDraft>(() => emptyDraft(nextKey()));
  // The checked request, once the person has asked to review it.
  const [review, setReview] = useState<MedicationStackSetupInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One id per distinct request, so retrying a lost response is safe while an edited request is a new one.
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);

  const change = (patch: Partial<SetupDraft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setError(null);
  };
  const changeComponent = (key: string, patch: Partial<ComponentDraft>) =>
    change({
      components: draft.components.map((component) =>
        component.key === key ? { ...component, ...patch } : component
      ),
    });

  const operationId = () => {
    const fingerprint = JSON.stringify(draft);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, id: crypto.randomUUID() };
    return attempt.current.id;
  };

  const goToReview = () => {
    const check = checkSetup(draft, operationId());
    if (!check.ok) {
      setError(
        check.code === 'rampOpenEnded'
          ? t(
              'medications.stacks.setup.rampOpenEnded',
              'Each ramp phase except the last needs a number of days.'
            )
          : check.message ||
              t('medications.stacks.invalid', 'Check the stack and try again.')
      );
      return;
    }
    setReview(check.data);
  };

  const submit = () => {
    if (!review) return;
    setup.mutate(review, {
      onSuccess: onClose,
      onError: (failure) => {
        const status = (failure as { status?: number }).status;
        setError(
          status === 400 || status === 409 || status === 422
            ? failure.message
            : t(
                'medications.stacks.setup.failed',
                'Could not set up the stack. Nothing was saved. Please try again.'
              )
        );
        setReview(null);
      },
    });
  };

  const known = new Set(
    (medsQuery.data ?? []).flatMap((med) =>
      [med.name, med.display_name]
        .filter((text): text is string => Boolean(text))
        .map((text) => text.trim().toLowerCase())
    )
  );

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    extra: { inputMode?: 'decimal' | 'numeric'; type?: string } = {}
  ) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        inputMode={extra.inputMode}
        type={extra.type}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );

  const componentRow = (component: ComponentDraft, index: number) => {
    const n = index + 1;
    const id = (part: string) => `setup-${component.key}-${part}`;
    const preview = componentPreview(component);
    return (
      <fieldset
        key={component.key}
        className="space-y-3 rounded-lg border p-3"
        aria-label={t(
          'medications.stacks.setup.componentN',
          'Component {{n}}',
          {
            n,
          }
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {t('medications.stacks.setup.componentN', 'Component {{n}}', { n })}
          </p>
          {draft.components.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t(
                'medications.stacks.setup.removeComponent',
                'Remove component {{n}}',
                { n }
              )}
              onClick={() =>
                change({
                  components: draft.components.filter(
                    (item) => item.key !== component.key
                  ),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {field(
          id('name'),
          t('medications.stacks.setup.medicineName', 'Medicine name'),
          component.name,
          (name) => changeComponent(component.key, { name })
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 space-y-1">
            <Label htmlFor={id('conc')} className="text-xs">
              {t('medications.stacks.setup.concentration', 'Concentration')}
            </Label>
            <div className="flex gap-2">
              <Input
                id={id('conc')}
                inputMode="decimal"
                value={component.concentration}
                onChange={(event) =>
                  changeComponent(component.key, {
                    concentration: event.target.value,
                  })
                }
              />
              <select
                aria-label={t(
                  'medications.stacks.setup.concentrationUnit',
                  'Concentration unit'
                )}
                className={selectClass}
                value={component.concentrationUnit}
                onChange={(event) =>
                  changeComponent(component.key, {
                    concentrationUnit: event.target
                      .value as StackConcentrationUnit,
                  })
                }
              >
                <option value="mcg/ml">mcg/mL</option>
                <option value="mg/ml">mg/mL</option>
              </select>
            </div>
          </div>
          {field(
            id('vial'),
            t('medications.stacks.setup.vialVolume', 'Vial volume (mL)'),
            component.vialVolume,
            (vialVolume) => changeComponent(component.key, { vialVolume }),
            { inputMode: 'decimal' }
          )}
          {field(
            id('qty'),
            t('medications.stacks.setup.quantity', 'Vials'),
            component.quantity,
            (quantity) => changeComponent(component.key, { quantity }),
            { inputMode: 'numeric' }
          )}
          {field(
            id('dose'),
            t('medications.stacks.setup.doseVolume', 'Dose volume (mL)'),
            component.doseVolume,
            (doseVolume) => changeComponent(component.key, { doseVolume }),
            { inputMode: 'decimal' }
          )}
        </div>
        {preview && (
          <p className="text-sm text-muted-foreground" role="status">
            {t(
              'medications.stacks.setup.preview',
              '{{volume}} mL → {{dose}} · {{vial}}/vial',
              { volume: preview.volume, dose: preview.dose, vial: preview.vial }
            )}
          </p>
        )}
        {component.ramp ? (
          <div className="space-y-2 rounded-md bg-muted/40 p-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">
                {t('medications.stacks.setup.rampTitle', 'Titration ramp')}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => changeComponent(component.key, { ramp: null })}
              >
                {t('medications.stacks.setup.removeRamp', 'Remove ramp')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.stacks.setup.rampHelp',
                'Phases run in order from the start date. Leave days blank on the last phase to keep it going.'
              )}
            </p>
            {component.ramp.map((row, rowIndex) => {
              const setRow = (patch: Partial<typeof row>) =>
                changeComponent(component.key, {
                  ramp: component.ramp!.map((item) =>
                    item.key === row.key ? { ...item, ...patch } : item
                  ),
                });
              return (
                <div key={row.key} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={id(`r${row.key}d`)} className="text-xs">
                      {t(
                        'medications.stacks.setup.rampDose',
                        'Phase {{n}} dose',
                        { n: rowIndex + 1 }
                      )}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={id(`r${row.key}d`)}
                        inputMode="decimal"
                        value={row.dose}
                        onChange={(event) =>
                          setRow({ dose: event.target.value })
                        }
                      />
                      <select
                        aria-label={t(
                          'medications.stacks.setup.rampUnit',
                          'Phase {{n}} unit',
                          { n: rowIndex + 1 }
                        )}
                        className={selectClass}
                        value={row.unit}
                        onChange={(event) =>
                          setRow({ unit: event.target.value as StackDoseUnit })
                        }
                      >
                        <option value="mcg">mcg</option>
                        <option value="mg">mg</option>
                      </select>
                    </div>
                  </div>
                  <div className="w-24 space-y-1">
                    <Label htmlFor={id(`r${row.key}n`)} className="text-xs">
                      {t(
                        'medications.stacks.setup.rampDays',
                        'Phase {{n}} days',
                        { n: rowIndex + 1 }
                      )}
                    </Label>
                    <Input
                      id={id(`r${row.key}n`)}
                      inputMode="numeric"
                      value={row.days}
                      onChange={(event) => setRow({ days: event.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t(
                      'medications.stacks.setup.removePhase',
                      'Remove phase {{n}}',
                      { n: rowIndex + 1 }
                    )}
                    onClick={() =>
                      changeComponent(component.key, {
                        ramp: component.ramp!.filter(
                          (item) => item.key !== row.key
                        ),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                changeComponent(component.key, {
                  ramp: [...component.ramp!, newRampRow(nextKey())],
                })
              }
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('medications.stacks.setup.addPhase', 'Add phase')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              changeComponent(component.key, { ramp: [newRampRow(nextKey())] })
            }
          >
            {t('medications.stacks.setup.addRamp', '+ Titration ramp')}
          </Button>
        )}
      </fieldset>
    );
  };

  const summary = (data: MedicationStackSetupInput) => {
    return (
      <div
        className="space-y-3"
        aria-label={t(
          'medications.stacks.setup.summaryTitle',
          'Review before saving'
        )}
      >
        <p className="text-sm font-medium">
          {t('medications.stacks.setup.summaryTitle', 'Review before saving')}
        </p>
        <p className="text-sm">
          {t('medications.stacks.setup.summaryStack', {
            defaultValue_one:
              'Stack “{{name}}” with {{count}} medicine, starting {{date}}.',
            defaultValue_other:
              'Stack “{{name}}” with {{count}} medicines, starting {{date}}.',
            name: data.name,
            count: data.components.length,
            date:
              data.start_date ?? t('medications.stacks.setup.today', 'today'),
          })}
        </p>
        <ul className="space-y-2 text-sm">
          {data.components.map((component, index) => {
            const preview = componentPreview(draft.components[index]!);
            const exists = known.has(component.medication_name.toLowerCase());
            return (
              <li
                key={draft.components[index]!.key}
                className="rounded-md border p-2"
              >
                <p className="font-medium">
                  {component.medication_name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {exists
                      ? t(
                          'medications.stacks.setup.useExisting',
                          '(uses your existing medicine)'
                        )
                      : t(
                          'medications.stacks.setup.createNew',
                          '(new injectable medicine)'
                        )}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {t('medications.stacks.setup.summaryVials', {
                    defaultValue_one:
                      '{{count}} premixed vial of {{volume}} mL ({{vial}}), in use.',
                    defaultValue_other:
                      '{{count}} premixed vials of {{volume}} mL ({{vial}} each): the first in use, the rest sealed.',
                    count: component.quantity,
                    volume: component.vial_volume_ml,
                    vial: preview?.vial ?? '',
                  })}
                </p>
                <p className="text-muted-foreground">
                  {component.steps?.length
                    ? t(
                        'medications.stacks.setup.summaryRamp',
                        'Daily plan with a {{phases}}-phase titration ramp.',
                        { phases: component.steps.length }
                      )
                    : t(
                        'medications.stacks.setup.summaryPlan',
                        'Daily plan: {{volume}} mL = {{dose}}.',
                        {
                          volume: preview?.volume ?? '',
                          dose: preview?.dose ?? '',
                        }
                      )}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t('medications.stacks.setup.title', 'Set up a premixed stack')}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (review) submit();
            else goToReview();
          }}
        >
          {review ? (
            summary(review)
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.stacks.setup.help',
                  'For compounded vials that come premixed and are taken together. This creates each medicine (or uses the one with the same name), its vials and a daily plan, then groups them in a stack.'
                )}
              </p>
              {field(
                'setup-stack-name',
                t('medications.stacks.setup.stackName', 'Stack name'),
                draft.name,
                (name) => change({ name })
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {field(
                  'setup-start',
                  t(
                    'medications.stacks.setup.startDate',
                    'Start date (optional)'
                  ),
                  draft.startDate,
                  (startDate) => change({ startDate }),
                  { type: 'date' }
                )}
                {field(
                  'setup-time',
                  t(
                    'medications.stacks.setup.timeOfDay',
                    'Time of day (optional)'
                  ),
                  draft.timeOfDay,
                  (timeOfDay) => change({ timeOfDay }),
                  { type: 'time' }
                )}
              </div>
              {draft.components.map(componentRow)}
              <Button
                type="button"
                variant="outline"
                disabled={draft.components.length >= MAX_STACK_SETUP_COMPONENTS}
                onClick={() =>
                  change({
                    components: [...draft.components, newComponent(nextKey())],
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('medications.stacks.setup.addComponent', 'Add component')}
              </Button>
              {field(
                'setup-notes',
                t('common.notes', 'Notes'),
                draft.notes,
                (notes) => change({ notes })
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {review ? (
              <Button
                type="button"
                variant="outline"
                disabled={setup.isPending}
                onClick={() => setReview(null)}
              >
                {t('common.back', 'Back')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
            <Button type="submit" disabled={setup.isPending}>
              {review
                ? setup.isPending
                  ? t('medications.stacks.setup.creating', 'Creating…')
                  : t('medications.stacks.setup.create', 'Create stack')
                : t('medications.stacks.setup.review', 'Review')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
