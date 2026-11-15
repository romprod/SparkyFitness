import { useTranslation } from 'react-i18next';
import type { MedicationPreparation } from '@workspace/shared';

export default function SavedPreparation({
  preparation,
  expanded = false,
}: {
  preparation: MedicationPreparation;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details
      open={expanded || undefined}
      className="mt-2 rounded-md border p-3 text-sm"
    >
      <summary className="cursor-pointer font-medium">
        {t('medications.preparation.saved', 'Saved preparation')}
      </summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">
          {t('medications.preparation.mode', 'Preparation type')}
        </dt>
        <dd>
          {t(`medications.preparation.${preparation.mode}`, preparation.mode)}
        </dd>
        <dt className="text-muted-foreground">
          {t('medications.preparation.massValue', 'Vial content')}
        </dt>
        <dd>
          {preparation.mass_value} {preparation.mass_unit}
        </dd>
        <dt className="text-muted-foreground">
          {t('medications.preparation.finalVolume', 'Final volume')}
        </dt>
        <dd>{preparation.final_volume_ml} mL</dd>
        <dt className="text-muted-foreground">
          {t('medications.preparation.preparedDate', 'Prepared date')}
        </dt>
        <dd>{preparation.prepared_date}</dd>
        {preparation.diluent && (
          <>
            <dt className="text-muted-foreground">
              {t('medications.preparation.diluent', 'Diluent (optional)')}
            </dt>
            <dd>{preparation.diluent}</dd>
          </>
        )}
        <dt className="text-muted-foreground">
          {t(
            'medications.glp1InventoryManager.concentrationMgML',
            'Concentration (mg/mL)'
          )}
        </dt>
        <dd>{preparation.concentration_mg_ml} mg/mL</dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          'medications.preparation.immutable',
          'Original preparation details are saved and cannot be changed.'
        )}
      </p>
    </details>
  );
}
