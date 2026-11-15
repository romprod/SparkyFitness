import { useTranslation } from 'react-i18next';
import { preparationBudNotice, todayInZone } from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';
import { Badge } from '@/components/ui/badge';

/** BUD is a calendar day: the named day is usable; notices never block logging. */
export default function MedicationBudWarning({
  date,
}: {
  date?: string | null;
}) {
  const { t } = useTranslation();
  const { timezone } = usePreferences();
  const notice = preparationBudNotice(date, todayInZone(timezone));
  if (!notice) return null;
  const days = notice.daysRemaining;
  return (
    <Badge
      variant={days < 0 ? 'destructive' : 'secondary'}
      className={
        days < 0
          ? 'whitespace-normal'
          : 'whitespace-normal bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      }
    >
      {days < 0
        ? t(
            'medications.preparationFlow.pastBud',
            'Past beyond-use date ({{date}}).',
            { date }
          )
        : t(
            'medications.preparationFlow.nearBud',
            'Beyond-use date {{date}} — {{days}} days left.',
            { date, days }
          )}
    </Badge>
  );
}
