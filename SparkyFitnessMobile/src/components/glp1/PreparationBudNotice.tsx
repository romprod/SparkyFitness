import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { preparationBudNotice } from '@workspace/shared';
import { getTodayDate } from '../../utils/dateUtils';

export default function PreparationBudNotice({
  date,
}: {
  date: string | null | undefined;
}) {
  const { t } = useTranslation();
  const notice = preparationBudNotice(date, getTodayDate());
  if (!notice) return null;
  return (
    <Text className="text-sm text-text-warning">
      {notice.state === 'passed'
        ? t('medications.preparation.budPassed', {
            defaultValue:
              'This preparation is past its recorded beyond-use date.',
          })
        : t('medications.preparation.budApproaching', {
            defaultValue: 'The recorded beyond-use date is within three days.',
          })}
    </Text>
  );
}
