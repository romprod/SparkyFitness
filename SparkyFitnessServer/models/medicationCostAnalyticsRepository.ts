import type { PoolClient } from 'pg';
import {
  buildMedicationCostAnalytics,
  instantToDay,
  isValidTimeZone,
  type MedicationCostWindow,
  type MedicationCostAnalytics,
  type MedicationCostInvoice,
  type MedicationCostVial,
  type MedicationCostDose,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import { assertMedicationFinancialOwner } from './medicationPurchaseRepository.js';
type InvoiceRow = Omit<MedicationCostInvoice, 'lines'>;
type LineRow = MedicationCostInvoice['lines'][number] & {
  purchase_id: string;
  sort_index: number;
};
/** Owner-only projection. All financial, label and dose inputs share one read snapshot. */
export async function getMedicationCostAnalytics(
  userId: string,
  window: MedicationCostWindow = '12',
  now: Date = new Date()
): Promise<MedicationCostAnalytics> {
  assertMedicationFinancialOwner(userId);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const preferences = await client.query<{ timezone: string | null }>(
      'SELECT timezone FROM user_preferences WHERE user_id=$1',
      [userId]
    );
    const configured = preferences.rows[0]?.timezone;
    const zone = configured && isValidTimeZone(configured) ? configured : 'UTC';
    const today = instantToDay(now, zone);
    const medications = await client.query<{ id: string; name: string }>(
      'SELECT id,COALESCE(display_name,name) AS name FROM medications WHERE user_id=$1 ORDER BY id',
      [userId]
    );
    const invoices = await client.query<InvoiceRow>(
      'SELECT id,ordered_date::text,currency,shipping_cost::text,tax_cost::text,other_fees::text,discount::text,allocation_method FROM medication_purchases WHERE user_id=$1 ORDER BY id',
      [userId]
    );
    const lines = await client.query<LineRow>(
      'SELECT id,purchase_id,kind,medication_id,category,quantity,unit_cost::text,units_per_pack,units_per_dose::text,sort_index FROM medication_purchase_items WHERE user_id=$1 ORDER BY purchase_id,sort_index,id',
      [userId]
    );
    const vials = await client.query<MedicationCostVial>(
      "SELECT p.id,p.medication_id,p.label_mass_mg::text,p.status,v.purchase_item_id FROM medication_pens p LEFT JOIN medication_purchase_vials v ON v.pen_id=p.id AND v.user_id=p.user_id WHERE p.user_id=$1 AND p.kind='vial' ORDER BY p.id",
      [userId]
    );
    const doses = await client.query<MedicationCostDose>(
      'SELECT medication_id,pen_id,entry_date::text,dose_mg::text,volume_ml::text,dose_input_unit FROM injection_entries WHERE user_id=$1 ORDER BY id',
      [userId]
    );
    const result = buildMedicationCostAnalytics({
      today,
      window,
      medications: medications.rows,
      invoices: invoices.rows.map((invoice) => ({
        ...invoice,
        lines: lines.rows.filter((line) => line.purchase_id === invoice.id),
      })),
      vials: vials.rows,
      doses: doses.rows,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
