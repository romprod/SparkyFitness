import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Syringe } from 'lucide-react';
import {
  INJECTION_SITES,
  localDateTimeToUtc,
  medicationDoseInMg,
  type CalculatedDrawInput,
  positiveDrawDoseSchema,
} from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';
import InjectionSitePicker from './InjectionSitePicker';
import { useInjectionSiteSelection } from '@/hooks/useInjectionSiteSelection';
import InjectionSiteSettings from './InjectionSiteSettings';
import MedicationSyringeSettings from './MedicationSyringeSettings';
import MedicationDrawPreview from './MedicationDrawPreview';
import {
  useMedicationSyringes,
  useMedicationDrawPreview,
} from '@/hooks/useMedicationSyringes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DateTimeInput } from '@/components/ui/TimeInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useMedicationPens,
  useLogInjectionMutation,
} from '@/hooks/useMedications';
import type { Medication } from '@/types/medications';

interface Glp1LogInjectionProps {
  med: Medication;
}

export default function Glp1LogInjection({ med }: Glp1LogInjectionProps) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const medId = med.id;

  const pensQ = useMedicationPens(medId);
  const logMutation = useLogInjectionMutation(medId);

  const siteSelection = useInjectionSiteSelection(medId);
  const { sitesQ, site, setSelectedSite } = siteSelection;

  const inUsePen = pensQ.data?.find(
    (p) => p.status === 'in_use' || p.status === 'sealed'
  );

  const [doseMg, setDoseMg] = useState(
    medicationDoseInMg(med) != null ? String(medicationDoseInMg(med)) : ''
  );
  const [injectedAt, setInjectedAt] = useState('');
  const [injectionNotes, setInjectionNotes] = useState('');
  const [penChoice, setPenChoice] = useState<string | null>(null);
  const selectedPen =
    penChoice === null
      ? inUsePen
      : pensQ.data?.find(
          (p) =>
            p.id === penChoice &&
            (p.status === 'sealed' || p.status === 'in_use')
        );
  const lostPenSelection =
    penChoice !== null && penChoice !== 'none' && !selectedPen;
  const effectivePenId = selectedPen?.id ?? 'none';
  const syringesQ = useMedicationSyringes();
  const [syringeChoice, setSyringeChoice] = useState<string | null>(null);
  const [doseUnit, setDoseUnit] =
    useState<CalculatedDrawInput['dose']['unit']>('mg');
  const hasDrawConcentration =
    selectedPen?.kind === 'vial' &&
    (!!selectedPen.preparation ||
      (Number.isFinite(selectedPen.concentration_mg_ml) &&
        (selectedPen.concentration_mg_ml ?? 0) > 0));
  const availableSyringes = syringesQ.data?.syringes ?? [];
  const automaticSyringe =
    availableSyringes.find(
      (syringe) => syringe.id === syringesQ.data?.default_syringe_id
    ) ?? availableSyringes[0];
  const effectiveSyringeId = hasDrawConcentration
    ? (syringeChoice ?? automaticSyringe?.id ?? 'none')
    : 'none';
  const selectedSyringe = availableSyringes.find(
    (syringe) => syringe.id === effectiveSyringeId
  );
  // Reset only the amount/unit when its vial or device identity/calibration changes.
  // Conditional render-time reset prevents an old units/mL draft reaching the new binding.
  const contextKey = JSON.stringify([
    medId,
    effectivePenId,
    selectedPen?.preparation?.id ?? selectedPen?.concentration_mg_ml,
    effectiveSyringeId,
    selectedSyringe?.graduation_type,
    selectedSyringe?.units_per_ml,
    selectedSyringe?.capacity_ml,
    selectedSyringe?.capacity_units,
    selectedSyringe?.increment,
  ]);
  const [selectionContext, setSelectionContext] = useState<string | null>(null);
  const selectionChanged =
    selectionContext !== null && selectionContext !== contextKey;
  if (
    pensQ.data !== undefined &&
    syringesQ.data !== undefined &&
    selectionContext !== contextKey
  ) {
    setSelectionContext(contextKey);
    if (selectionContext !== null) {
      setDoseMg('');
      setDoseUnit('mg');
    }
  }
  const currentDose = selectionChanged ? '' : doseMg;
  const currentDoseUnit = selectionChanged ? 'mg' : doseUnit;
  const calculatedMode = effectiveSyringeId !== 'none';
  const calculatedInput: CalculatedDrawInput | null =
    calculatedMode &&
    !!selectedSyringe &&
    positiveDrawDoseSchema.safeParse({
      value: currentDose.trim(),
      unit: currentDoseUnit,
    }).success
      ? {
          syringe_id: effectiveSyringeId,
          dose: { value: currentDose.trim(), unit: currentDoseUnit },
        }
      : null;
  const previewQ = useMedicationDrawPreview(
    calculatedMode ? effectivePenId : null,
    calculatedInput
  );
  const preview = calculatedMode && calculatedInput ? previewQ.data : undefined;
  const calculationBlocked =
    calculatedMode &&
    (!preview ||
      previewQ.isFetching ||
      previewQ.isError ||
      preview.warnings.some((warning) => warning.severity === 'block'));
  const manualDose =
    currentDoseUnit === 'mg' && currentDose.trim() ? Number(currentDose) : null;
  const doseValid =
    !lostPenSelection &&
    (calculatedMode
      ? !calculationBlocked
      : manualDose != null && Number.isFinite(manualDose) && manualDose > 0);

  const handleLog = () => {
    if (!doseValid) return;
    const willDeduct = effectivePenId !== 'none';
    logMutation.mutate(
      {
        medication_id: medId,
        site,
        ...(calculatedMode && calculatedInput
          ? { calculated_draw: calculatedInput }
          : { dose_mg: manualDose }),
        injected_at: injectedAt
          ? localDateTimeToUtc(injectedAt, timezone).toISOString()
          : undefined,
        pen_id: willDeduct ? effectivePenId : null,
        deduct_pen: willDeduct,
        notes: injectionNotes.trim() || null,
      },
      {
        onSuccess: () => {
          setSelectedSite(null);
          setInjectedAt('');
          setInjectionNotes('');
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Syringe className="h-4 w-4 text-blue-500" />{' '}
          {t('medications.glp1.logInjection', 'Log injection')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="glp1-pen" className="text-xs text-muted-foreground">
            {t('medications.glp1.deduct', 'Deduct from pen/vial')}
          </Label>
          <Select
            value={effectivePenId}
            onValueChange={(value) => {
              setPenChoice(value);
              setDoseMg('');
              setDoseUnit('mg');
            }}
          >
            <SelectTrigger id="glp1-pen">
              <SelectValue
                placeholder={t('medications.glp1.dontDeduct', "Don't deduct")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t('medications.glp1.dontDeduct', "Don't deduct")}
              </SelectItem>
              {(pensQ.data ?? [])
                .filter((p) => p.status === 'sealed' || p.status === 'in_use')
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t(
                      'medications.glp1.left',
                      '{{kind}}{{dose_mg}} · {{doses_total}} left',
                      {
                        kind: p.kind,
                        dose_mg: p.dose_mg ? ` ${p.dose_mg}mg` : '',
                        doses_total: (p.doses_total ?? 0) - p.doses_used,
                      }
                    )}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {lostPenSelection && (
          <p className="text-sm text-destructive">
            {t(
              'medications.syringes.stockUnavailable',
              'The selected stock is no longer active. Choose a pen or vial again.'
            )}
          </p>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="glp1-syringe">
              {t('medications.syringes.select', 'Syringe')}
            </Label>
            <MedicationSyringeSettings />
          </div>
          <Select
            value={effectiveSyringeId}
            onValueChange={(value) => {
              setSyringeChoice(value);
              setDoseMg('');
              setDoseUnit('mg');
            }}
            disabled={!hasDrawConcentration}
          >
            <SelectTrigger id="glp1-syringe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t('medications.syringes.manualDose', 'Manual dose (mg)')}
              </SelectItem>
              {(syringesQ.data?.syringes ?? []).map((syringe) => (
                <SelectItem key={syringe.id} value={syringe.id}>
                  {syringe.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!hasDrawConcentration && (
            <p className="text-xs text-muted-foreground">
              {t(
                'medications.syringes.preparationRequired',
                'Select a vial with a known concentration to calculate a syringe marking.'
              )}
            </p>
          )}
          {hasDrawConcentration &&
            syringeChoice !== null &&
            syringeChoice !== 'none' &&
            syringesQ.data !== undefined &&
            !selectedSyringe && (
              <p className="text-sm text-destructive">
                {t(
                  'medications.syringes.syringeUnavailable',
                  'The selected syringe is no longer available. Choose another syringe or Manual dose (mg).'
                )}
              </p>
            )}
          {syringesQ.isError && (
            <p className="text-sm text-destructive">
              {t('medications.syringes.loadError', 'Could not load syringes.')}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label
              htmlFor="glp1-dose"
              className="text-xs text-muted-foreground"
            >
              {calculatedMode
                ? t('medications.syringes.enteredDose', 'Entered amount')
                : t('medications.glp1.doseMg', 'Dose (mg)')}
            </Label>
            <Input
              id="glp1-dose"
              type="text"
              inputMode="decimal"
              value={
                calculatedMode || currentDoseUnit === 'mg' ? currentDose : ''
              }
              onChange={(e) => {
                setDoseMg(e.target.value);
                if (!calculatedMode) setDoseUnit('mg');
              }}
              placeholder={
                medicationDoseInMg(med) != null
                  ? String(medicationDoseInMg(med))
                  : '0'
              }
            />
            {calculatedMode && (
              <>
                <Label htmlFor="glp1-dose-unit" className="sr-only">
                  {t('medications.syringes.doseUnit', 'Amount unit')}
                </Label>
                <Select
                  value={currentDoseUnit}
                  onValueChange={(value) =>
                    setDoseUnit(value as typeof doseUnit)
                  }
                >
                  <SelectTrigger id="glp1-dose-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['mcg', 'mg', 'ml', 'units'] as const).map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit === 'ml' ? 'mL' : unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label
              id="glp1-injected-at-label"
              className="text-xs text-muted-foreground"
            >
              {t('medications.glp1.dateTime', 'Date & time')}
            </Label>
            <DateTimeInput
              aria-labelledby="glp1-injected-at-label"
              value={injectedAt}
              onChange={setInjectedAt}
            />
          </div>
        </div>

        {calculatedMode && selectedSyringe && (
          <MedicationDrawPreview
            preview={preview}
            isFetching={previewQ.isFetching}
            isError={previewQ.isError}
          />
        )}

        <div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              <Trans
                i18nKey="medications.glp1.injectionSiteGreenSuggestedAmber"
                defaults={
                  'Injection site · <span>green = suggested</span>, <span2>amber = resting <{{days}}d</span2>'
                }
                values={{ days: sitesQ.data?.restDays ?? 7 }}
                components={{
                  span: <span className="text-green-600" />,
                  span2: <span className="text-amber-600" />,
                }}
              />
            </Label>
            <InjectionSiteSettings />
          </div>
          <div className="mt-2">
            <InjectionSitePicker selection={siteSelection} />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {t('medications.glp1.notes', 'Notes')}
          </Label>
          <Input
            value={injectionNotes}
            onChange={(e) => setInjectionNotes(e.target.value)}
            placeholder={t(
              'medications.glp1.notesPlaceholder',
              'e.g. Mild stinging, felt fine'
            )}
          />
        </div>

        <Button
          onClick={handleLog}
          disabled={!site || !doseValid || logMutation.isPending}
          className="w-full"
        >
          {logMutation.isPending
            ? t('medications.common.logging', 'Logging…')
            : site
              ? t(
                  'medications.glp1.logInjectionAt',
                  'Log injection — {{site}}',
                  {
                    site: t(
                      'medications.sites.label.' + site,
                      INJECTION_SITES.find((s) => s.id === site)?.label ?? site
                    ),
                  }
                )
              : t('medications.glp1.logInjection', 'Log injection')}
        </Button>
      </CardContent>
    </Card>
  );
}
