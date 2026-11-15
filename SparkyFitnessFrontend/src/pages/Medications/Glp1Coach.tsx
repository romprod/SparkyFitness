import { resolvePreparedMedicationRoute } from '@workspace/shared';
import type { Medication } from '@/types/medications';
import FastingTimer from './FastingTimer';
import Glp1LogInjection from './Glp1LogInjection';
import Glp1InventoryManager from './Glp1InventoryManager';
import Glp1TitrationManager from './Glp1TitrationManager';
import Glp1RecentInjections from './Glp1RecentInjections';
import Glp1AmountChart from './Glp1AmountChart';

export default function Glp1Coach({ med }: { med: Medication }) {
  const drug = med.custom_fields?.['glp1_drug'];
  const isOralGlp1 =
    drug === 'oral_semaglutide' ||
    (drug === 'custom' && med.custom_fields?.['custom_is_oral'] === true);
  const hasPreparationTools = resolvePreparedMedicationRoute(med) !== null;
  return (
    <div className="space-y-4">
      {isOralGlp1 && <FastingTimer medId={med.id} />}
      {hasPreparationTools && <Glp1LogInjection key={med.id} med={med} />}
      <Glp1AmountChart med={med} />
      {hasPreparationTools && <Glp1InventoryManager med={med} />}
      <Glp1TitrationManager med={med} />
      {hasPreparationTools && <Glp1RecentInjections med={med} />}
    </div>
  );
}
