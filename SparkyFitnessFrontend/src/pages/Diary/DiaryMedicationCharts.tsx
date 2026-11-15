import { useTranslation } from 'react-i18next';
import type { Medication } from '@/types/medications';
import Glp1AmountChart from '@/pages/Medications/Glp1AmountChart';

export default function DiaryMedicationCharts({
  medications,
}: {
  medications: Medication[];
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'diary.medicationCharts.current',
          'Current modelled amounts, independent of the selected diary date.'
        )}
      </p>
      {medications.map((med) => (
        <section
          key={med.id}
          aria-label={med.display_name || med.name}
          className="min-w-0 space-y-2"
        >
          <h3 className="font-semibold break-words">
            {med.display_name || med.name}
          </h3>
          <Glp1AmountChart key={med.id} med={med} />
        </section>
      ))}
    </div>
  );
}
