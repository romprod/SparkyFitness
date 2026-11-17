import type { PoolClient } from 'pg';
import type {
  MedicationCostInvoice,
  MedicationCostVial,
  MedicationCostPrescription,
} from '@workspace/shared';
type Line = MedicationCostInvoice['lines'][number] & { purchase_id: string };
export interface MedicationPrescriptionFinancialSnapshot {
  invoices: MedicationCostInvoice[];
  vials: MedicationCostVial[];
  prescriptions: MedicationCostPrescription[];
}
/** Only minimal owner financial facts from explicit stock links, through the caller's RR client. */
export async function loadMedicationPrescriptionFinancialSnapshot(
  client: PoolClient,
  owner: string
): Promise<MedicationPrescriptionFinancialSnapshot> {
  const invoices = await client.query<Omit<MedicationCostInvoice, 'lines'>>(
    'SELECT id,ordered_date::text,currency,shipping_cost::text,tax_cost::text,other_fees::text,discount::text,allocation_method FROM medication_purchases WHERE user_id=$1 ORDER BY id',
    [owner]
  );
  const lines = await client.query<Line>(
    'SELECT id,purchase_id,kind,medication_id,category,quantity,unit_cost::text,units_per_pack,units_per_dose::text,sort_index FROM medication_purchase_items WHERE user_id=$1 ORDER BY purchase_id,sort_index,id',
    [owner]
  );
  const vials = await client.query<MedicationCostVial>(
    "SELECT p.id,p.medication_id,p.kind,p.label_mass_mg::text,p.status,v.purchase_item_id,p.prescription_id FROM medication_pens p LEFT JOIN medication_purchase_vials v ON v.pen_id=p.id AND v.user_id=p.user_id WHERE p.user_id=$1 AND p.kind='vial' ORDER BY p.id",
    [owner]
  );
  const prescriptions = await client.query<MedicationCostPrescription>(
    "SELECT DISTINCT r.id,r.medication_id,r.cost::text,r.currency,r.date_written::text,r.cost_basis FROM medication_prescriptions r JOIN medication_pens p ON p.prescription_id=r.id AND p.user_id=r.user_id AND p.medication_id=r.medication_id WHERE p.user_id=$1 AND p.kind='vial' ORDER BY r.id",
    [owner]
  );
  return {
    invoices: invoices.rows.map((row) => ({
      ...row,
      lines: lines.rows.filter((line) => line.purchase_id === row.id),
    })),
    vials: vials.rows,
    prescriptions: prescriptions.rows,
  };
}
