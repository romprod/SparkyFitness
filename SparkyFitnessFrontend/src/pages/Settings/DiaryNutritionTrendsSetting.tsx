import { useTranslation } from 'react-i18next';
import { useDiaryNutritionTrendsVisibility } from '@/hooks/Diary/useDiaryNutritionTrendsVisibility';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function DiaryNutritionTrendsSetting() {
  const { t } = useTranslation();
  const { checked, disabled, failed, save } =
    useDiaryNutritionTrendsVisibility();
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="diary-nutrition-trends">
          {t(
            'settings.nutrientDisplay.showDiaryTrends',
            'Show 14-day nutrition trends in Diary'
          )}
        </Label>
        <Switch
          id="diary-nutrition-trends"
          checked={checked}
          disabled={disabled}
          onCheckedChange={save}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'settings.nutrientDisplay.diaryTrendsHelp',
          "Keeps today's nutrition summary visible. Applies to desktop and mobile; resetting the Diary layout restores this setting."
        )}
      </p>
      {failed && (
        <p role="alert" className="text-sm">
          {t(
            'settings.nutrientDisplay.diaryTrendsError',
            'Could not confirm this display setting. The previous setting is still shown; reload before trying again.'
          )}
        </p>
      )}
    </div>
  );
}
