import {
  resolvePreparedMedicationRoute,
  type MedicationCourseTimelineRow,
} from '@workspace/shared';
import { useState, useEffect, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import DayNavigator from '@/components/DayNavigator';
import {
  Package,
  Trash2,
  Activity,
  Star,
  Clock,
  Pencil,
  Info,
  Pill,
  Syringe,
  Plus,
  FlaskConical,
  Receipt,
} from 'lucide-react';
import {
  todayInZone,
  addDays,
  getDueDosesForDate,
  formatDose,
  formatStrengthPerUnit,
  filterEntriesBySubtype,
  filterMedsBySubtype,
  type MedSubtype,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useMedications,
  useDeleteMedicationMutation,
  useMedicationEntries,
} from '@/hooks/useMedications';
import { useSymptomEntries } from '@/hooks/useSymptoms';
import { usePreferences } from '@/contexts/PreferencesContext';
import type { MedicationDetail } from '@/types/medications';
import Glp1Coach from './Glp1Coach';
import PeptideStock from './PeptideStock';
import MedicationCosts from './MedicationCosts';
import MedicationPrescriptions from './MedicationPrescriptions';
import { useMedicationPrescriptionScope } from '@/hooks/Medications/useMedicationPrescriptions';
import { useMedicationPurchaseScope } from '@/hooks/useMedicationPurchases';
import Glp1InventoryManager from './Glp1InventoryManager';
import Glp1LogInjection from './Glp1LogInjection';
import Glp1RecentInjections from './Glp1RecentInjections';
import AddMedicationDialog, { MedTypeIcon } from './AddMedicationDialog';
import { countMedicationNutrients } from './medicationUtils';
import ScheduleManager from './ScheduleManager';
import MedicationCourseTimeline from './MedicationCourseTimeline';
import TodayMedications from './TodayMedications';
import MedicationLogCalendar from './MedicationLogCalendar';
import MedicationSmoothWeek from './MedicationSmoothWeek';
import MedicationScheduleMove from './MedicationScheduleMove';
import MedicationSupplyTile from './MedicationSupplyTile';
import MedicationWellnessTile from './MedicationWellnessTile';
import MedicationNextDoses from './MedicationNextDoses';
import MedicationLevelsOverlay from './MedicationLevelsOverlay';
import MedicationBlendCard from './MedicationBlendCard';
import SymptomsHub from '../Symptoms/SymptomsHub';
import MedicationDisclaimer from './MedicationDisclaimer';
import { formatScheduleDescription } from './medicationUtils';

export default function Medications() {
  const { t } = useTranslation();
  const purchaseScope = useMedicationPurchaseScope();
  const prescriptionScope = useMedicationPrescriptionScope();
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab =
    tabParam === 'cabinet' ||
    tabParam === 'stock' ||
    tabParam === 'symptoms' ||
    tabParam === 'prescriptions' ||
    tabParam === 'costs'
      ? tabParam
      : 'today';
  const setActiveTab = (
    tab: 'today' | 'cabinet' | 'stock' | 'symptoms' | 'costs' | 'prescriptions'
  ) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', tab);
      return next;
    });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [focusRevisionId, setFocusRevisionId] = useState<string>();

  // `All | Meds | Supplements` view filter. Persisted so it survives navigation, and it
  // filters the shared meds list rather than fetching a separate one — the whole point of
  // the middle-path approach (one page, one data source, one adherence engine).
  const [subtype, setSubtype] = useState<MedSubtype>(() => {
    // Validate rather than blind-cast: an unrecognised stored value would otherwise fall
    // through to the "meds" branch with no segmented button highlighted.
    const stored = localStorage.getItem('medications.subtypeFilter');
    return stored === 'meds' || stored === 'supplements' || stored === 'all'
      ? stored
      : 'all';
  });
  const setSubtypeFilter = (next: MedSubtype) => {
    setSubtype(next);
    localStorage.setItem('medications.subtypeFilter', next);
  };

  const manageTimelinePlan = (row: MedicationCourseTimelineRow) => {
    if (!row.medication_id || !row.is_current_tip) return;
    setTimelineOpen(false);
    setSubtypeFilter('all');
    setSelectedId(row.medication_id);
    setFocusRevisionId(row.revision_id);
    setActiveTab('cabinet');
  };
  const dateParam = searchParams.get('date');

  const preferencesContext = usePreferences();
  const timezone =
    preferencesContext?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeFormat = preferencesContext?.timeFormat ?? 'h:mm A';
  const today = todayInZone(timezone);

  const [selectedDate, setSelectedDate] = useState<string>(
    () => dateParam || today
  );

  useEffect(() => {
    const targetDate = dateParam || today;
    if (targetDate !== selectedDate) {
      setSelectedDate(targetDate);
    }
  }, [dateParam, today, selectedDate]);

  const thirtyDaysAgo = useMemo(
    () => addDays(selectedDate, -30),
    [selectedDate]
  );

  // Queries
  const { data: meds = [], isLoading: loadingMeds } = useMedications({
    activeOnly: true,
  });

  // The stock tab needs retired medications too (their vials can still await preparation).
  const { data: stockMeds = [] } = useMedications(
    { activeOnly: false },
    { enabled: activeTab === 'stock' }
  );

  // Also check if any symptom entries exist — either meds or symptoms means
  // the user has already accepted the disclaimer.
  const { data: anySymptoms = [], isLoading: loadingSymptoms } =
    useSymptomEntries();

  const { data: entries = [], isLoading: loadingEntries } =
    useMedicationEntries({
      fromDate: selectedDate,
      toDate: selectedDate,
    });

  const { data: recentEntries = [] } = useMedicationEntries({
    fromDate: thirtyDaysAgo,
    toDate: selectedDate,
  });

  // The filtered list feeding both the Log view and the Cabinet list. Because
  // TodayMedications derives its dose list AND the adherence overview from this prop,
  // filtering here makes the adherence numbers respect the filter for free.
  const visibleMeds = useMemo(
    () => filterMedsBySubtype(meds as MedicationDetail[], subtype),
    [meds, subtype]
  );

  // "Scheduled today" KPI honours the same subtype filter as the Cabinet list + tiles.
  const dueTodayCount = useMemo(() => {
    return getDueDosesForDate(visibleMeds, selectedDate, timezone).length;
  }, [visibleMeds, selectedDate, timezone]);

  // Logged entries belong to a medication, so the Today log has to respect the same filter
  // as the dose list above it — otherwise "Supplements" still lists medication doses (with a
  // broken icon lookup) and the counts disagree with what's shown.
  //
  // "All" must NOT filter, though: an entry whose medication has since been deleted has no
  // match in `meds`, so filtering by id would silently drop that history from the one view
  // that is supposed to show everything.
  const visibleMedIds = useMemo(
    () => new Set(visibleMeds.map((m) => m.id)),
    [visibleMeds]
  );
  const visibleEntries = useMemo(
    () => filterEntriesBySubtype(entries, visibleMedIds, subtype),
    [entries, visibleMedIds, subtype]
  );
  const visibleRecentEntries = useMemo(
    () => filterEntriesBySubtype(recentEntries, visibleMedIds, subtype),
    [recentEntries, visibleMedIds, subtype]
  );

  // Supplement-only users land on the Supplements view — but only as a one-time soft
  // default that never overrides a filter the user has already chosen and saved.
  const [autoDefaulted, setAutoDefaulted] = useState(false);
  useEffect(() => {
    if (autoDefaulted || loadingMeds) return;
    setAutoDefaulted(true);
    if (
      localStorage.getItem('medications.subtypeFilter') === null &&
      meds.length > 0 &&
      meds.every((m) => m.is_supplement)
    ) {
      setSubtype('supplements');
    }
  }, [autoDefaulted, loadingMeds, meds]);

  // Mutations
  const removeMedMutation = useDeleteMedicationMutation();

  const handleDeleteMed = (id: string) =>
    removeMedMutation.mutate(id, { onSuccess: () => setSelectedId(null) });

  // Resolve the detail pane from the FILTERED list, so switching the subtype filter clears
  // a selection that is no longer visible instead of leaving its Edit/Delete card orphaned.
  const selected = visibleMeds.find((m) => m.id === selectedId) ?? null;

  // If no medications AND no symptom entries exist (and user hasn't accepted
  // this session), show the disclaimer gate — similar to CycleOnboarding.
  // Having any existing medication OR symptom entry means they accepted previously.
  const hasExistingData = meds.length > 0 || anySymptoms.length > 0;
  const stillLoading = loadingMeds || loadingSymptoms;

  if (
    !stillLoading &&
    !hasExistingData &&
    !disclaimerAccepted &&
    activeTab !== 'costs' &&
    activeTab !== 'prescriptions'
  ) {
    return (
      <div className="space-y-4">
        {prescriptionScope.ready && (
          <Button
            variant="outline"
            onClick={() => setActiveTab('prescriptions')}
          >
            {t('medications.prescriptions.title', 'Prescriptions')}
          </Button>
        )}
        {purchaseScope.ready && (
          <Button variant="outline" onClick={() => setActiveTab('costs')}>
            <Receipt className="mr-2 h-4 w-4" />
            {t('medications.costs.title', 'Costs')}
          </Button>
        )}
        <MedicationDisclaimer onAccept={() => setDisclaimerAccepted(true)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Navigation & Date Filter Row */}
      <div className="w-full flex flex-col lg:flex-row items-center gap-4 lg:gap-6 border-b pb-3 mb-6">
        {/* Navigation Pills */}
        <div className="flex flex-wrap items-center justify-center lg:justify-start gap-1 flex-1">
          <Button
            variant={activeTab === 'today' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('today')}
            className={`rounded-full px-4 h-9 gap-2 transition-all ${
              activeTab === 'today'
                ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span className="text-xs font-semibold">
              {t('medications.tabs.log', 'Log')}
            </span>
          </Button>
          <Button
            variant={activeTab === 'cabinet' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('cabinet')}
            className={`rounded-full px-4 h-9 gap-2 transition-all ${
              activeTab === 'cabinet'
                ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <Package className="w-4 h-4" />
            <span className="text-xs font-semibold">
              {t('medications.tabs.cabinet', 'Cabinet')}
            </span>
          </Button>
          <Button
            variant={activeTab === 'stock' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('stock')}
            className={`rounded-full px-4 h-9 gap-2 transition-all ${activeTab === 'stock' ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
          >
            <FlaskConical className="w-4 h-4" />
            <span className="text-xs font-semibold">
              {t('medications.stock.title', 'Inventory')}
            </span>
          </Button>
          {purchaseScope.ready && (
            <Button
              variant={activeTab === 'costs' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('costs')}
              className={`rounded-full px-4 h-9 gap-2 transition-all ${activeTab === 'costs' ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              <Receipt className="w-4 h-4" />
              <span className="text-xs font-semibold">
                {t('medications.costs.title', 'Costs')}
              </span>
            </Button>
          )}
          {prescriptionScope.ready && (
            <Button
              variant={activeTab === 'prescriptions' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('prescriptions')}
              className="rounded-full px-4 h-9 gap-2"
            >
              <span className="text-xs font-semibold">
                {t('medications.prescriptions.title', 'Prescriptions')}
              </span>
            </Button>
          )}
          <Button
            variant={activeTab === 'symptoms' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('symptoms')}
            className={`rounded-full px-4 h-9 gap-2 transition-all ${
              activeTab === 'symptoms'
                ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span className="text-xs font-semibold">
              {t('medications.tabs.symptoms', 'Symptoms')}
            </span>
          </Button>
          <span className="mx-2 text-muted-foreground/30 hidden sm:inline">
            |
          </span>
          <AddMedicationDialog
            trigger={
              <Button size="sm" className="rounded-full h-9 gap-2">
                <Plus className="h-4 w-4" />
                <span className="text-xs font-semibold">
                  {t('medications.cabinet.addMed', 'Add medication')}
                </span>
              </Button>
            }
          />
          <AddMedicationDialog
            defaultIsSupplement
            trigger={
              <Button size="sm" className="rounded-full h-9 gap-2">
                <Plus className="h-4 w-4" />
                <span className="text-xs font-semibold">
                  {t('medications.cabinet.addSupplement', 'Add supplement')}
                </span>
              </Button>
            }
          />
        </div>

        {/* Vertical Divider (Desktop Only) */}
        {activeTab !== 'stock' && activeTab !== 'costs' && (
          <div className="hidden lg:block w-px h-6 bg-border" />
        )}

        {/* Date Filter */}
        {activeTab !== 'stock' && activeTab !== 'costs' && (
          <div className="shrink-0">
            <DayNavigator
              selectedDate={selectedDate}
              onDateChange={(d) =>
                setSearchParams((previous) => {
                  const next = new URLSearchParams(previous);
                  next.set('date', d);
                  return next;
                })
              }
              className="flex items-center justify-end gap-2 mb-0"
            />
          </div>
        )}
      </div>

      {/* Subtype filter — reuses the sub-tab button styling for visual consistency.
          Symptoms has no meds list, so the filter is hidden there. */}
      {(activeTab === 'today' || activeTab === 'cabinet') && (
        <div className="-mt-2 flex flex-wrap items-center justify-center gap-1 lg:justify-start">
          {(
            [
              ['all', t('medications.subtype.all', 'All')],
              ['meds', t('medications.subtype.meds', 'Meds')],
              [
                'supplements',
                t('medications.subtype.supplements', 'Supplements'),
              ],
            ] as [MedSubtype, string][]
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={subtype === value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setSubtypeFilter(value)}
              className={`rounded-full px-4 h-8 transition-all ${
                subtype === value
                  ? 'bg-slate-200/60 dark:bg-muted shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <span className="text-xs font-semibold">{label}</span>
            </Button>
          ))}
        </div>
      )}

      {activeTab === 'stock' && (
        <PeptideStock meds={stockMeds.length > 0 ? stockMeds : meds} />
      )}
      {activeTab === 'costs' && purchaseScope.ready && <MedicationCosts />}
      {activeTab === 'prescriptions' && prescriptionScope.ready && (
        <MedicationPrescriptions medications={meds as MedicationDetail[]} />
      )}

      {activeTab === 'today' && (
        <>
          <MedicationNextDoses medications={visibleMeds} today={today} />
          <MedicationSupplyTile />
          <MedicationWellnessTile />
          <MedicationLevelsOverlay medications={visibleMeds} today={today} />
          <MedicationLogCalendar
            medications={visibleMeds}
            selectedDate={selectedDate}
            subtype={subtype}
            onSelectDate={(date) =>
              setSearchParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set('date', date);
                return next;
              })
            }
          />
          <MedicationScheduleMove medications={meds as MedicationDetail[]} />
          <MedicationSmoothWeek medications={meds as MedicationDetail[]} />
          <TodayMedications
            selectedDate={selectedDate}
            today={today}
            meds={visibleMeds}
            entries={visibleEntries}
            recentEntries={visibleRecentEntries}
            loadingMeds={loadingMeds}
            loadingEntries={loadingEntries}
            subtype={subtype}
            onSelectDate={(d) =>
              setSearchParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set('date', d);
                return next;
              })
            }
          />
        </>
      )}

      {activeTab === 'cabinet' && (
        <div className="space-y-6">
          {/* KPI tiles (real counts only — no cost) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: t('medications.cabinet.activeScripts', 'Active scripts'),
                value: visibleMeds.filter((m) => m.is_active).length,
                Icon: Pill,
                color: 'text-rose-500',
              },
              {
                label: t('medications.cabinet.glp1Meds', 'GLP-1 meds'),
                value: visibleMeds.filter((m) => m.is_active && m.is_glp1)
                  .length,
                Icon: Syringe,
                color: 'text-blue-500',
              },
              {
                label: t(
                  'medications.cabinet.scheduledToday',
                  'Scheduled today'
                ),
                value: dueTodayCount,
                Icon: Clock,
                color: 'text-amber-500',
              },
              {
                label: t('medications.cabinet.totalMeds', 'Total meds'),
                value: visibleMeds.length,
                Icon: Activity,
                color: 'text-slate-500',
              },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={`rounded-lg bg-muted p-2 ${kpi.color}`}>
                    <kpi.Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold leading-none">
                      {kpi.value}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                      {kpi.label}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 md:grid-cols-[380px_1fr]">
            {/* Medications List */}
            <div className="space-y-4">
              {visibleMeds.length === 0 && (
                <Card>
                  <CardContent className="p-6 text-center text-sm text-muted-foreground">
                    {subtype === 'supplements'
                      ? t(
                          'medications.cabinet.emptySupplements',
                          'No supplements yet. Add your first one to get started.'
                        )
                      : subtype === 'meds'
                        ? t(
                            'medications.cabinet.emptyMeds',
                            'No medications yet. Add your first one to get started.'
                          )
                        : t(
                            'medications.cabinet.empty',
                            'No medications yet. Add your first one to get started.'
                          )}
                  </CardContent>
                </Card>
              )}
              {visibleMeds.map((med) => (
                <Card
                  key={med.id}
                  onClick={() => setSelectedId(med.id)}
                  className={`cursor-pointer transition hover:shadow-sm ${
                    selectedId === med.id
                      ? 'border-primary ring-1 ring-primary'
                      : ''
                  }`}
                >
                  <CardContent className="flex items-center justify-between gap-2 p-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <MedTypeIcon
                        typeId={med.type_id}
                        isGlp1={med.is_glp1}
                        className="h-5 w-5 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {med.display_name || med.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{formatDose(med) ?? med.type_id}</span>
                          {med.schedules?.[0] && (
                            <>
                              <span>·</span>
                              <span>
                                {formatScheduleDescription(
                                  med.schedules[0],
                                  timeFormat
                                )}
                              </span>
                            </>
                          )}
                          {med.prescriber && (
                            <>
                              <span>·</span>
                              <span className="truncate">
                                {t(
                                  'medications.cabinet.drPrescriber',
                                  'Dr. {{prescriber}}',
                                  { prescriber: med.prescriber }
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {!med.is_active && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px]"
                      >
                        {t('medications.common.inactive', 'Inactive')}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Selected Medication Details (Drawer-like Right Column) */}
            <div className="min-w-0">
              {!selected ? (
                <Card className="h-full border-dashed flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <div className="rounded-full bg-muted p-3 mb-3">
                    <Info className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-sm font-semibold">
                    {t(
                      'medications.noSelection.title',
                      'No medication selected'
                    )}
                  </CardTitle>
                  <CardDescription className="max-w-[240px] mt-1 text-xs">
                    {t(
                      'medications.noSelection.description',
                      'Select a medication from the list to view schedules, notes, and GLP-1 coaching tools.'
                    )}
                  </CardDescription>
                </Card>
              ) : (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-base font-bold break-words">
                            {selected.display_name || selected.name}
                          </CardTitle>
                          {selected.is_glp1 && (
                            <Badge className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] px-1.5 py-0">
                              {t('medications.glp1Name', 'GLP-1')}
                            </Badge>
                          )}
                          {selected.is_supplement &&
                            countMedicationNutrients(selected.nutrients) >
                              0 && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {t('medications.cabinet.nutrientCount', {
                                  defaultValue: '{{count}} nutrient',
                                  defaultValue_other: '{{count}} nutrients',
                                  count: countMedicationNutrients(
                                    selected.nutrients
                                  ),
                                })}
                              </Badge>
                            )}
                        </div>
                        <CardDescription className="text-xs mt-0.5">
                          {[
                            formatDose(selected),
                            formatStrengthPerUnit(selected),
                          ]
                            .filter(Boolean)
                            .join(' · ') || selected.type_id}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <AddMedicationDialog
                          key={selected.id}
                          editMed={selected}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteMed(selected.id)}
                          disabled={removeMedMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      {/* Advanced details cards / sections */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {selected.prescriber && (
                          <div className="rounded-lg bg-muted/40 p-2 border">
                            <p className="text-[10px] font-semibold text-muted-foreground">
                              {t(
                                'medications.cabinet.prescriberDetail',
                                'Prescriber'
                              )}
                            </p>
                            <p className="font-medium mt-0.5 truncate">
                              {selected.prescriber}
                            </p>
                          </div>
                        )}
                        {selected.pharmacy && (
                          <div className="rounded-lg bg-muted/40 p-2 border">
                            <p className="text-[10px] font-semibold text-muted-foreground">
                              {t(
                                'medications.cabinet.pharmacyDetail',
                                'Pharmacy'
                              )}
                            </p>
                            <p className="font-medium mt-0.5 truncate">
                              {selected.pharmacy}
                            </p>
                          </div>
                        )}
                        {selected.rx_number && (
                          <div className="rounded-lg bg-muted/40 p-2 border col-span-2">
                            <p className="text-[10px] font-semibold text-muted-foreground">
                              {t(
                                'medications.cabinet.rxNumberDetail',
                                'Rx Number'
                              )}
                            </p>
                            <p className="font-medium mt-0.5 truncate">
                              {selected.rx_number}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Photo / Pill Image Display (Phase A) */}
                      {selected.photo_path && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t(
                              'medications.cabinet.packagingPhoto',
                              'Pill/Packaging Photo'
                            )}
                          </p>
                          <div className="relative aspect-video rounded-lg overflow-hidden border bg-muted flex items-center justify-center">
                            <img
                              src={selected.photo_path}
                              alt={selected.display_name || selected.name}
                              className="object-cover w-full h-full"
                              onError={(e) => {
                                // hide broken images gracefully
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Effectiveness Rating (Phase A) */}
                      {selected.effectiveness_rating != null && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t(
                              'medications.cabinet.effectivenessDetail',
                              'Effectiveness'
                            )}
                          </p>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={`h-4 w-4 ${
                                  i < (selected.effectiveness_rating ?? 0)
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-muted/40'
                                }`}
                              />
                            ))}
                            <span className="text-xs font-medium text-muted-foreground ml-1">
                              ({selected.effectiveness_rating}/5)
                            </span>
                          </div>
                        </div>
                      )}

                      {selected.reason_text && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t('medications.cabinet.reason', 'Reason')}
                          </p>
                          <p className="mt-0.5">{selected.reason_text}</p>
                        </div>
                      )}

                      {selected.notes && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground">
                            {t('medications.cabinet.notes', 'Notes')}
                          </p>
                          <p className="whitespace-pre-wrap mt-0.5">
                            {selected.notes}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {selected.type_id === 'injection' &&
                    !selected.is_supplement && (
                      <MedicationBlendCard
                        key={selected.id}
                        medication={{
                          id: selected.id,
                          name: selected.display_name || selected.name,
                        }}
                        candidates={meds
                          .filter(
                            (m) => !m.is_supplement && m.id !== selected.id
                          )
                          .map((m) => ({
                            id: m.id,
                            name: m.display_name || m.name,
                          }))}
                      />
                    )}

                  {selected.is_glp1 ? (
                    <div className="space-y-4">
                      <Glp1Coach med={selected} />
                      <ScheduleManager
                        med={selected}
                        onTimeline={() => setTimelineOpen(true)}
                        focusRevisionId={focusRevisionId}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Activity className="h-4 w-4 text-primary" />{' '}
                            {t(
                              'medications.today.adherenceTitle',
                              'Adherence overview'
                            )}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          <Trans
                            i18nKey="medications.cabinet.schedulesAndDailyChecklistsFor"
                            defaults={
                              'Schedules and daily checklists for non-GLP-1 medications are fully active. Manage schedule rules below, and log daily intake from the <strong>Today</strong> tab.'
                            }
                            components={{ strong: <strong /> }}
                          />
                        </CardContent>
                      </Card>
                      {resolvePreparedMedicationRoute(selected) !== null && (
                        <>
                          <Glp1InventoryManager med={selected} />
                          <Glp1LogInjection key={selected.id} med={selected} />
                          <Glp1RecentInjections med={selected} />
                        </>
                      )}
                      <ScheduleManager
                        med={selected}
                        onTimeline={() => setTimelineOpen(true)}
                        focusRevisionId={focusRevisionId}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {timelineOpen && (
        <MedicationCourseTimeline
          medications={meds as MedicationDetail[]}
          onClose={() => setTimelineOpen(false)}
          onManage={manageTimelinePlan}
        />
      )}

      {activeTab === 'symptoms' && (
        <SymptomsHub
          variant="medications"
          selectedDate={selectedDate}
          onDateChange={(d) =>
            setSearchParams((previous) => {
              const next = new URLSearchParams(previous);
              next.set('date', d);
              return next;
            })
          }
          meds={meds as MedicationDetail[]}
          recentMedicationEntries={recentEntries}
        />
      )}
    </div>
  );
}
