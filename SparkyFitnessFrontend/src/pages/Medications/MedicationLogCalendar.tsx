import { useRef, useState } from 'react';
import { addDays, todayInZone } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useMedicationLogWeek } from '@/hooks/Medications/useMedicationLogWeek';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import MedicationMonthCalendar, {
  type MedicationLogCalendarProps,
} from './MedicationMonthCalendar';
import MedicationWeekView from './MedicationWeekView';
import MedicationCalendarDayDetail from './MedicationCalendarDayDetail';
import { medicationCalendarMonday } from './medicationCalendarDates';

export default function MedicationLogCalendar(
  props: MedicationLogCalendarProps
) {
  const { t } = useTranslation();
  const { timezone, formatDate } = usePreferences();
  const today = todayInZone(timezone);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [detail, setDetail] = useState<{
    day: string;
    scopeKey: string;
    medicationId?: string;
    trigger?: HTMLButtonElement | null;
  } | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const monday = medicationCalendarMonday(
    detail?.day ?? props.selectedDate,
    today
  );
  const result = useMedicationLogWeek(monday, view === 'week' || !!detail);
  if (detail && (!result.scope.ready || result.scope.key !== detail.scopeKey))
    setDetail(null);
  const controls = (
    <div
      role="group"
      aria-label={t('medications.week.view', 'Calendar view')}
      className="flex gap-2"
    >
      <Button
        size="sm"
        variant={view === 'week' ? 'default' : 'outline'}
        aria-pressed={view === 'week'}
        onClick={() => setView('week')}
      >
        {t('medications.week.week', 'Week')}
      </Button>
      <Button
        size="sm"
        variant={view === 'month' ? 'default' : 'outline'}
        aria-pressed={view === 'month'}
        onClick={() => setView('month')}
      >
        {t('medications.week.month', 'Month')}
      </Button>
    </div>
  );
  return (
    <>
      {view === 'month' ? (
        <MedicationMonthCalendar
          {...props}
          toolbar={controls}
          onOpenDay={(day, medicationId, trigger) => {
            if (result.scope.ready && result.scope.isCurrent()) {
              returnFocus.current = null;
              setDetail({
                day,
                scopeKey: result.scope.key,
                medicationId,
                trigger,
              });
            }
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('medications.week.title', 'Dose calendar')}
            </CardTitle>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {controls}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('medications.week.previous', 'Previous week')}
                  onClick={() => props.onSelectDate(addDays(monday, -7))}
                >
                  ←
                </Button>
                <span className="text-sm">
                  {formatDate(monday)} – {formatDate(addDays(monday, 6))}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('medications.week.next', 'Next week')}
                  onClick={() => props.onSelectDate(addDays(monday, 7))}
                >
                  →
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => props.onSelectDate(today)}
                >
                  {t('common.today', 'Today')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {result.query.isLoading && (
              <p role="status">{t('common.loading', 'Loading…')}</p>
            )}
            {result.query.isError && (
              <div role="alert">
                <p>
                  {t(
                    'medications.week.error',
                    'Could not load the dose calendar.'
                  )}
                </p>
                <Button
                  variant="outline"
                  onClick={() => void result.query.refetch()}
                >
                  {t('common.retry', 'Retry')}
                </Button>
              </div>
            )}
            {result.data && !result.query.isError && (
              <MedicationWeekView
                data={result.data}
                subtype={props.subtype ?? 'all'}
                onOpenDay={(day, trigger) => {
                  if (result.scope.ready && result.scope.isCurrent()) {
                    returnFocus.current = null;
                    props.onSelectDate(day);
                    setDetail({ day, scopeKey: result.scope.key, trigger });
                  }
                }}
              />
            )}
          </CardContent>
        </Card>
      )}
      {detail &&
        result.scope.ready &&
        result.scope.isCurrent() &&
        result.scope.key === detail.scopeKey && (
          <MedicationCalendarDayDetail
            key={`${detail.scopeKey}:${detail.day}`}
            day={detail.day}
            medicationId={detail.medicationId}
            result={result}
            medications={props.medications}
            subtype={props.subtype ?? 'all'}
            onClose={() => {
              returnFocus.current = detail.trigger ?? null;
              setDetail(null);
            }}
            onRestoreFocus={() => {
              const target = returnFocus.current;
              returnFocus.current = null;
              if (
                target === detail.trigger &&
                result.scope.isCurrent() &&
                target?.isConnected
              )
                target.focus();
            }}
            onSelectDate={(day) => {
              returnFocus.current = null;
              props.onSelectDate(day);
              setDetail({
                day,
                scopeKey: result.scope.key,
                medicationId: detail.medicationId,
                trigger: detail.trigger,
              });
            }}
          />
        )}
    </>
  );
}
