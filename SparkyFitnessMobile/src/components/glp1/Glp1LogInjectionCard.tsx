import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import Toast from 'react-native-toast-message';
import {
  INJECTION_SITES,
  medicationDoseInMg,
  positiveDrawDoseSchema,
  type CalculatedDrawInput,
  type DrawDoseUnit,
  type Medication,
} from '@workspace/shared';
import BottomSheetPicker from '../BottomSheetPicker';
import CalendarSheet, { type CalendarSheetRef } from '../CalendarSheet';
import DateSelectRow from '../DateSelectRow';
import FormInput from '../FormInput';
import Button from '../ui/Button';
import InjectionBodyMap from './InjectionBodyMap';
import SyringeDrawPreview from './SyringeDrawPreview';
import {
  useLogInjection,
  useMedicationPens,
  useSiteSuggestion,
} from '../../hooks/useGlp1';
import { useSyringeDrawPreview, useSyringes } from '../../hooks/useSyringes';
import { getTodayDate } from '../../utils/dateUtils';
import { resolveMapSites, usablePens, penDosesLeft } from '../../utils/glp1';
import { injectionSiteLabel } from '../../utils/medicationLocalization';
import { addLog } from '../../services/LogService';

interface Glp1LogInjectionCardProps {
  med: Medication;
  onManageSyringes: () => void;
}

const NO_PEN = 'none';

/**
 * Log an injection: pick a site on the body map (the server's rotation
 * suggestion is preselected), dose, day, and optionally the pen/vial to draw
 * from. Leaving the dose blank lets the server resolve it from the active
 * titration step or the medication default.
 */
const Glp1LogInjectionCard: React.FC<Glp1LogInjectionCardProps> = ({
  med,
  onManageSyringes,
}) => {
  const { t } = useTranslation();
  const calendarRef = useRef<CalendarSheetRef>(null);
  const siteQuery = useSiteSuggestion(med.id);
  const pensQuery = useMedicationPens(med.id);
  const logInjection = useLogInjection();
  const syringesQuery = useSyringes();
  const submittingRef = useRef(false);

  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [doseText, setDoseText] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(getTodayDate);
  const [penChoice, setPenChoice] = useState<string | null>(null);
  const [syringeChoice, setSyringeChoice] = useState<string | null>(null);
  const [doseUnit, setDoseUnit] = useState<DrawDoseUnit>('mg');
  const [doseContext, setDoseContext] = useState<string | null>(null);

  const mapSites = useMemo(
    () => resolveMapSites(siteQuery.data?.activeSiteIds),
    [siteQuery.data?.activeSiteIds]
  );
  const pens = useMemo(
    () => usablePens(pensQuery.data ?? []),
    [pensQuery.data]
  );

  const suggestedSite = siteQuery.data?.suggestedSiteId ?? null;
  const site = selectedSite ?? suggestedSite;
  // Default to the pen the server would pick, so drawing from inventory is the
  // path of least effort; "Don't deduct" stays one tap away.
  const stalePenChoice =
    !!penChoice &&
    penChoice !== NO_PEN &&
    !pens.some((pen) => pen.id === penChoice);
  const penId = stalePenChoice ? NO_PEN : (penChoice ?? pens[0]?.id ?? NO_PEN);

  const selectedPen = pens.find((pen) => pen.id === penId);
  const syringes = syringesQuery.data?.syringes ?? [];
  const preferredSyringe =
    syringes.find(
      (syringe) => syringe.id === syringesQuery.data?.default_syringe_id
    ) ?? syringes[0];
  const syringeId = syringeChoice ?? preferredSyringe?.id ?? '';
  const selectedSyringe = syringes.find((syringe) => syringe.id === syringeId);
  const calculatedMode = selectedPen?.kind === 'vial' && !!syringeId;
  const currentDoseContext = JSON.stringify([
    penId,
    selectedPen?.kind ?? '',
    selectedPen?.preparation?.id ?? selectedPen?.concentration_mg_ml ?? null,
    syringeId,
    selectedSyringe
      ? [
          selectedSyringe.id,
          selectedSyringe.graduation_type,
          selectedSyringe.units_per_ml,
          selectedSyringe.capacity_ml,
          selectedSyringe.capacity_units,
          selectedSyringe.increment,
        ]
      : null,
  ]);
  const doseContextChanged =
    doseContext !== null && doseContext !== currentDoseContext;
  const effectiveDoseText = doseContextChanged ? '' : doseText;
  const effectiveDoseUnit = doseContextChanged ? 'mg' : doseUnit;
  const manualUnitMismatch = !calculatedMode && effectiveDoseUnit !== 'mg';
  const parsedDose = positiveDrawDoseSchema.safeParse({
    value: effectiveDoseText.trim(),
    unit: effectiveDoseUnit,
  });
  const drawInput: CalculatedDrawInput | null =
    calculatedMode && selectedSyringe && parsedDose.success
      ? { syringe_id: syringeId, dose: parsedDose.data }
      : null;
  const preview = useSyringeDrawPreview(
    calculatedMode ? penId : null,
    drawInput
  );
  const drawBlocked =
    calculatedMode &&
    (!drawInput ||
      !preview.data ||
      preview.isFetching ||
      preview.isError ||
      preview.data.warnings.some((warning) => warning.severity === 'block'));

  const siteOptions = useMemo(
    () =>
      mapSites.map((s) => ({
        label: injectionSiteLabel(s.id, t),
        value: s.id,
      })),
    [mapSites, t]
  );
  const penOptions = useMemo(
    () => [
      {
        label: t('medications.glp1.log.dontDeduct', {
          defaultValue: "Don't deduct",
        }),
        value: NO_PEN,
      },
      ...pens.map((p) => {
        const left = penDosesLeft(p);
        return {
          label: [
            p.label ||
              (p.kind === 'vial'
                ? t('medications.glp1.inventory.vial', {
                    defaultValue: 'Vial',
                  })
                : t('medications.glp1.inventory.pen', {
                    defaultValue: 'Pen',
                  })),
            p.dose_mg != null ? `${p.dose_mg} mg` : null,
            left != null
              ? t('medications.glp1.inventory.left', {
                  defaultValue: '{{count}} left',
                  count: left,
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          value: p.id,
        };
      }),
    ],
    [pens, t]
  );

  const handleLog = () => {
    if (
      !site ||
      logInjection.isPending ||
      submittingRef.current ||
      stalePenChoice ||
      doseContextChanged ||
      manualUnitMismatch ||
      drawBlocked
    )
      return;
    const dose =
      effectiveDoseText.trim() === '' ? null : Number(effectiveDoseText);
    if (
      !calculatedMode &&
      dose !== null &&
      (!Number.isFinite(dose) || dose <= 0)
    ) {
      Toast.show({
        type: 'error',
        text1: t('medications.glp1.log.invalidDose', {
          defaultValue: 'Enter a valid dose',
        }),
      });
      return;
    }
    const deduct = penId !== NO_PEN;
    // Today logs the real moment; a past day has no time to speak of, so it is
    // pinned to noon local time, which keeps it on that day in any timezone.
    const injectedAt =
      date === getTodayDate() ? new Date() : new Date(`${date}T12:00:00`);
    submittingRef.current = true;
    logInjection.mutate(
      {
        medication_id: med.id,
        site,
        ...(calculatedMode && drawInput
          ? { calculated_draw: drawInput }
          : { dose_mg: dose }),
        injected_at: injectedAt.toISOString(),
        entry_date: date,
        pen_id: deduct ? penId : null,
        deduct_pen: deduct,
        notes: notes.trim() || null,
      },
      {
        onSettled: () => {
          submittingRef.current = false;
        },
        onSuccess: () => {
          setSelectedSite(null);
          setDoseText('');
          setDoseContext(null);
          setDoseUnit('mg');
          setNotes('');
          setPenChoice(null);
          Toast.show({
            type: 'success',
            text1: t('medications.glp1.log.logged', {
              defaultValue: 'Injection logged',
            }),
          });
        },
        onError: (error) => {
          addLog(`Failed to log injection: ${error.message}`, 'ERROR');
          Toast.show({
            type: 'error',
            text1: t('medications.glp1.log.failed', {
              defaultValue: 'Failed to log injection',
            }),
          });
        },
      }
    );
  };

  const siteLabel =
    site && INJECTION_SITES.some((s) => s.id === site)
      ? injectionSiteLabel(site, t)
      : null;

  return (
    <View className="bg-surface rounded-xl p-4 mb-3 shadow-sm">
      <Text className="text-base font-semibold text-text-primary">
        {t('medications.glp1.log.title', { defaultValue: 'Log injection' })}
      </Text>
      <View className="flex-row gap-4 mt-4">
        <View className="flex-1 gap-1.5">
          <Text className="text-text-secondary text-sm font-medium">
            {calculatedMode
              ? t('medications.syringes.dose', {
                  defaultValue: 'Target dose / volume',
                })
              : t('medications.glp1.log.dose', { defaultValue: 'Dose (mg)' })}
          </Text>
          <FormInput
            accessibilityLabel={
              calculatedMode
                ? t('medications.syringes.dose', {
                    defaultValue: 'Target dose / volume',
                  })
                : t('medications.glp1.log.dose', { defaultValue: 'Dose (mg)' })
            }
            value={effectiveDoseText}
            onChangeText={(value) => {
              setPenChoice(penId);
              setDoseContext(currentDoseContext);
              if (doseContextChanged || !calculatedMode) setDoseUnit('mg');
              setDoseText(value);
            }}
            keyboardType="decimal-pad"
            placeholder={
              !calculatedMode && medicationDoseInMg(med) != null
                ? String(medicationDoseInMg(med))
                : t('medications.glp1.log.dosePlaceholder', {
                    defaultValue: 'Auto',
                  })
            }
          />
        </View>
        <View className="flex-1 gap-1.5">
          <Text className="text-text-secondary text-sm font-medium">
            {t('medications.glp1.log.pen', { defaultValue: 'From pen / vial' })}
          </Text>
          <BottomSheetPicker
            value={penId}
            options={penOptions}
            onSelect={(value) => {
              setPenChoice(value);
              setDoseText('');
              setDoseContext(null);
              setDoseUnit('mg');
            }}
            title={t('medications.glp1.log.penTitle', {
              defaultValue: 'Deduct from',
            })}
          />
        </View>
      </View>

      {doseContextChanged && (
        <Text className="text-sm text-text-warning mt-3">
          {t('medications.syringes.reenterDose', {
            defaultValue: 'The vial or syringe changed. Enter the dose again.',
          })}
        </Text>
      )}

      {stalePenChoice && (
        <Text className="text-sm text-text-warning mt-3">
          {t('medications.syringes.selectActiveVial', {
            defaultValue:
              'The selected vial is no longer active. Choose an active vial or choose not to deduct.',
          })}
        </Text>
      )}

      {selectedPen?.kind === 'vial' && (
        <View className="gap-3 mt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-text-secondary">
              {t('medications.syringes.syringe', { defaultValue: 'Syringe' })}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setDoseText('');
                setDoseContext(null);
                setDoseUnit('mg');
                onManageSyringes();
              }}
            >
              <Text className="text-sm font-semibold text-accent-primary">
                {t('medications.syringes.manage', {
                  defaultValue: 'Manage syringes',
                })}
              </Text>
            </TouchableOpacity>
          </View>
          <BottomSheetPicker
            value={syringeId}
            onSelect={(value) => {
              setSyringeChoice(value);
              setDoseText('');
              setDoseContext(null);
              setDoseUnit('mg');
            }}
            title={t('medications.syringes.syringe', {
              defaultValue: 'Syringe',
            })}
            options={[
              {
                value: '',
                label: t('medications.syringes.manual', {
                  defaultValue: 'Manual dose (mg)',
                }),
              },
              ...(syringesQuery.data?.syringes ?? []).map((syringe) => ({
                value: syringe.id,
                label: syringe.name,
              })),
            ]}
          />
          {calculatedMode && (
            <>
              <BottomSheetPicker
                value={effectiveDoseUnit}
                onSelect={(value) => {
                  setPenChoice(penId);
                  if (doseContextChanged) setDoseText('');
                  setDoseContext(currentDoseContext);
                  setDoseUnit(value);
                }}
                title={t('medications.syringes.inputUnit', {
                  defaultValue: 'Input unit',
                })}
                options={[
                  {
                    value: 'mcg' as const,
                    label: t('medications.preparation.unitMcg', {
                      defaultValue: 'mcg',
                    }),
                  },
                  {
                    value: 'mg' as const,
                    label: t('medications.preparation.unitMg', {
                      defaultValue: 'mg',
                    }),
                  },
                  {
                    value: 'ml' as const,
                    label: t('medications.syringes.ml', { defaultValue: 'mL' }),
                  },
                  {
                    value: 'units' as const,
                    label: t('medications.syringes.units', {
                      defaultValue: 'Units',
                    }),
                  },
                ]}
              />
              <SyringeDrawPreview
                data={drawInput ? preview.data : undefined}
                pending={preview.isFetching}
                failed={preview.isError}
                showNeutral={!!selectedSyringe}
              />
            </>
          )}
        </View>
      )}

      <Text className="text-xs text-text-muted mt-4 mb-3">
        {t('medications.glp1.log.legend', {
          defaultValue:
            'Green is the suggested site. Amber was used in the last {{days}} days.',
          days: siteQuery.data?.restDays ?? 7,
        })}
      </Text>

      <InjectionBodyMap
        sites={mapSites}
        selectedSiteId={site}
        suggestedSiteId={suggestedSite}
        restingSiteIds={siteQuery.data?.restingSiteIds}
        onSelect={setSelectedSite}
      />
      {/* The map is touch-only; the picker is the accessible way to choose a site. */}
      <View className="mt-3">
        <BottomSheetPicker
          value={site ?? ''}
          options={siteOptions}
          onSelect={setSelectedSite}
          placeholder={t('medications.glp1.log.chooseSite', {
            defaultValue: 'Choose a site',
          })}
          title={t('medications.glp1.log.siteTitle', {
            defaultValue: 'Injection site',
          })}
        />
      </View>

      <View className="mt-4">
        <DateSelectRow
          date={date}
          onPress={() => calendarRef.current?.present()}
        />
      </View>

      <View className="gap-1.5 mt-4">
        <Text className="text-text-secondary text-sm font-medium">
          {t('medications.glp1.log.notes', { defaultValue: 'Notes' })}
        </Text>
        <FormInput
          value={notes}
          onChangeText={setNotes}
          placeholder={t('medications.glp1.log.notesPlaceholder', {
            defaultValue: 'e.g. Mild stinging',
          })}
        />
      </View>

      <Button
        variant="primary"
        className="mt-4"
        onPress={handleLog}
        disabled={
          !site ||
          stalePenChoice ||
          doseContextChanged ||
          manualUnitMismatch ||
          drawBlocked
        }
        loading={logInjection.isPending}
      >
        {siteLabel
          ? t('medications.glp1.log.logAt', {
              defaultValue: 'Log injection: {{site}}',
              site: siteLabel,
            })
          : t('medications.glp1.log.title', { defaultValue: 'Log injection' })}
      </Button>

      <CalendarSheet
        ref={calendarRef}
        selectedDate={date}
        onSelectDate={(d) => {
          setDate(d);
          calendarRef.current?.dismiss();
        }}
      />
    </View>
  );
};

export default Glp1LogInjectionCard;
