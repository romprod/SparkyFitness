import { useTranslation } from 'react-i18next';
import { useMedicationPrescriptions } from '@/hooks/Medications/useMedicationPrescriptions';
import type { MedicationPen } from '@/types/medications';
import { otherCoveredNames } from './medicationPrescriptionPresentation';

/** "Rx: source · Change" line from Pitstop; shown only when a prescription is linked. */
export default function StockPrescriptionLine({
  pen,
  canWrite,
  onChange,
}: {
  pen: MedicationPen;
  canWrite: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useMedicationPrescriptions(!!pen.prescription_id);
  if (!pen.prescription_id) {
    // Stock still in play can be linked to a prescription from its card, as in Pitstop.
    if (
      !canWrite ||
      pen.kind !== 'vial' ||
      pen.status === 'finished' ||
      pen.status === 'discarded'
    )
      return null;
    return (
      <button
        type="button"
        className="text-primary hover:underline"
        onClick={onChange}
      >
        {t('medications.stockLayout.addRx', '+ Add prescription')}
      </button>
    );
  }
  const row = data?.prescriptions.find(
    (item) => item.id === pen.prescription_id
  );
  if (!row) return null;
  const name =
    row.source ??
    row.prescriber ??
    row.pharmacy ??
    t('medications.prescriptions.singular', 'Prescription');
  // A prescription shared with other medicines says so on every vial it covers.
  const alsoCovers = otherCoveredNames(row, pen.medication_id);
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
      <span>
        {t('medications.stockLayout.rx', 'Rx')}:{' '}
        <span className="text-foreground">{name}</span>
        {alsoCovers.length > 0 && (
          <>
            {' · '}
            {t('medications.stockLayout.alsoCovers', 'also covers {{names}}', {
              names: alsoCovers.join(', '),
            })}
          </>
        )}
      </span>
      {canWrite && (
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={onChange}
        >
          {t('medications.stockLayout.change', 'Change')}
        </button>
      )}
    </span>
  );
}
