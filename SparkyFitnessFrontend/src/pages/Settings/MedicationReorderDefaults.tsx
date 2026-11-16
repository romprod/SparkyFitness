import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Save } from 'lucide-react';
import {
  DEFAULT_MEDICATION_REORDER_LEAD_DAYS,
  DEFAULT_MEDICATION_REORDER_BUFFER_DAYS,
  medicationReorderDefaultsInputSchema,
  type MedicationReorderDefaults,
} from '@workspace/shared';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMedicationReorderDefaults } from '@/hooks/Medications/useMedicationInventoryForecast';

type DefaultsState = ReturnType<typeof useMedicationReorderDefaults>;
const fieldsFrom = (data: MedicationReorderDefaults) => ({
  lead: String(data.lead_days),
  buffer: String(data.buffer_days),
});

function DefaultsForm({
  state,
}: {
  state: DefaultsState & { data: MedicationReorderDefaults };
}) {
  const { t } = useTranslation();
  const { scope, data, save } = state;
  // Untouched fields follow reads; an explicit draft survives same-owner refreshes.
  const [draft, setDraft] = useState<ReturnType<typeof fieldsFrom> | null>(
    null
  );
  const fields = draft ?? fieldsFrom(data);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const allowed = scope.ready && scope.isCurrent();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !scope.ready || !scope.isCurrent()) return;
    const parsed = medicationReorderDefaultsInputSchema.safeParse({
      lead_days: /^\d+$/.test(fields.lead) ? Number(fields.lead) : NaN,
      buffer_days: /^\d+$/.test(fields.buffer) ? Number(fields.buffer) : NaN,
    });
    setSuccess(false);
    if (!parsed.success) {
      setError(
        t(
          'medications.forecasts.defaultsInvalid',
          'Enter a whole number from 0 to 2147483647 for each field.'
        )
      );
      return;
    }
    const scopeKey = scope.key;
    setSaving(true);
    setError(null);
    const current = () =>
      mounted.current &&
      scope.ready &&
      scope.isCurrent() &&
      scope.key === scopeKey;
    try {
      const saved = await save(parsed.data);
      if (!current()) return;
      setDraft(fieldsFrom(saved));
      setSuccess(true);
    } catch {
      if (current())
        setError(
          t(
            'medications.forecasts.defaultsSaveFailed',
            'Could not save reorder defaults. Please try again.'
          )
        );
    } finally {
      if (current()) setSaving(false);
    }
  };
  const edit = (field: 'lead' | 'buffer', value: string) => {
    setDraft({ ...fields, [field]: value });
    setError(null);
    setSuccess(false);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'medications.forecasts.defaultsHelp',
          'Set the lead time and extra days used by medication inventory forecasts. Saving these defaults does not place orders or send notifications.'
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('medications.forecasts.defaultsInitial', {
          defaultValue:
            'Default lead time is {{lead}} days and safety buffer is {{buffer}} days.',
          lead: DEFAULT_MEDICATION_REORDER_LEAD_DAYS,
          buffer: DEFAULT_MEDICATION_REORDER_BUFFER_DAYS,
        })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="medication-reorder-lead">
            {t('medications.forecasts.leadDays', 'Lead time (days)')}
          </Label>
          <Input
            id="medication-reorder-lead"
            inputMode="numeric"
            value={fields.lead}
            onChange={(event) => edit('lead', event.target.value)}
            disabled={!allowed || saving}
            aria-invalid={!!error}
            aria-describedby={error ? 'medication-reorder-error' : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="medication-reorder-buffer">
            {t('medications.forecasts.bufferDays', 'Safety buffer (days)')}
          </Label>
          <Input
            id="medication-reorder-buffer"
            inputMode="numeric"
            value={fields.buffer}
            onChange={(event) => edit('buffer', event.target.value)}
            disabled={!allowed || saving}
            aria-invalid={!!error}
            aria-describedby={error ? 'medication-reorder-error' : undefined}
          />
        </div>
      </div>
      {error && (
        <p
          id="medication-reorder-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm">
          {t('medications.forecasts.defaultsSaved', 'Reorder defaults saved.')}
        </p>
      )}
      <Button type="submit" disabled={!allowed || saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving
          ? t('medications.forecasts.defaultsSaving', 'Saving…')
          : t('medications.forecasts.defaultsSave', 'Save')}
      </Button>
    </form>
  );
}

export default function MedicationReorderDefaults() {
  const { t } = useTranslation();
  const state = useMedicationReorderDefaults();
  if (!state.scope.ready || !state.scope.isCurrent()) return null;
  return (
    <AccordionItem
      value="medication-reorder-defaults"
      className="border rounded-lg mb-4"
    >
      <AccordionTrigger
        className="flex items-center gap-2 p-4 hover:no-underline"
        description={t(
          'medications.forecasts.defaultsDescription',
          'Lead time and safety buffer for medication inventory forecasts'
        )}
      >
        <Package className="h-5 w-5" />
        {t(
          'medications.forecasts.defaultsTitle',
          'Medication reorder defaults'
        )}
      </AccordionTrigger>
      <AccordionContent className="p-4 pt-0">
        {state.data ? (
          <DefaultsForm
            key={state.scope.key}
            state={{ ...state, data: state.data }}
          />
        ) : state.query.isError ? (
          <div className="space-y-3">
            <p role="alert">
              {t(
                'medications.forecasts.defaultsLoadFailed',
                'Could not load reorder defaults.'
              )}
            </p>
            <Button
              variant="outline"
              disabled={state.query.isFetching}
              onClick={() => {
                if (state.scope.isCurrent()) void state.query.refetch();
              }}
            >
              {t('medications.forecasts.defaultsRetry', 'Try again')}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              'medications.forecasts.defaultsLoading',
              'Loading reorder defaults…'
            )}
          </p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
