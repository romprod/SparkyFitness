import { loadMedicationPrescriptionFinancialSnapshot } from './medicationPrescriptionFinancialSnapshot.js';
export { loadMedicationPrescriptionFinancialSnapshot } from './medicationPrescriptionFinancialSnapshot.js';
import type { PoolClient } from 'pg';
import {
  buildMedicationCostAnalytics,
  buildMedicationPrescriptionCostAnalytics,
  buildMedicationVialCostEstimates,
  allocateMedicationPurchase,
  type MedicationVialInvoicePrice,
  type MedicationPrescriptionCostAnalytics,
  type MedicationPrescriptionVialCosts,
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
export function getMedicationCostAnalytics(
  userId: string,
  window?: MedicationCostWindow,
  now?: Date,
  mode?: 'invoice_only'
): Promise<MedicationCostAnalytics>;
export function getMedicationCostAnalytics(
  userId: string,
  window: MedicationCostWindow | undefined,
  now: Date | undefined,
  mode: 'with_prescription_estimates'
): Promise<MedicationPrescriptionCostAnalytics>;
export async function getMedicationCostAnalytics(
  userId: string,
  window: MedicationCostWindow = '12',
  now: Date = new Date(),
  mode: 'invoice_only' | 'with_prescription_estimates' = 'invoice_only'
): Promise<MedicationCostAnalytics | MedicationPrescriptionCostAnalytics> {
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
    const financial =
      mode === 'with_prescription_estimates'
        ? await loadMedicationPrescriptionFinancialSnapshot(client, userId)
        : null;
    let invoiceFacts: MedicationCostInvoice[];
    let vialFacts: MedicationCostVial[];
    if (financial) {
      invoiceFacts = financial.invoices;
      vialFacts = financial.vials;
    } else {
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
      invoiceFacts = invoices.rows.map((invoice) => ({
        ...invoice,
        lines: lines.rows.filter((line) => line.purchase_id === invoice.id),
      }));
      vialFacts = vials.rows;
    }
    const doses = await client.query<MedicationCostDose>(
      'SELECT medication_id,pen_id,entry_date::text,dose_mg::text,volume_ml::text,dose_input_unit FROM injection_entries WHERE user_id=$1 ORDER BY id',
      [userId]
    );
    const inputs = {
      today,
      window,
      medications: medications.rows,
      invoices: invoiceFacts,
      vials: vialFacts,
      doses: doses.rows,
    };
    const result = financial
      ? buildMedicationPrescriptionCostAnalytics({
          ...inputs,
          prescriptions: financial.prescriptions,
        })
      : buildMedicationCostAnalytics(inputs);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Opt-in badge rates share the same resolver as usage/waste, without reading/decrypting clinical text. */
export async function getMedicationPrescriptionVialCosts(
  userId: string
): Promise<MedicationPrescriptionVialCosts> {
  assertMedicationFinancialOwner(userId);
  const client: PoolClient = await getClient(userId);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const facts = await loadMedicationPrescriptionFinancialSnapshot(
      client,
      userId
    );
    const invoice_prices: MedicationVialInvoicePrice[] = [];
    for (const invoice of facts.invoices) {
      const allocated = allocateMedicationPurchase(invoice);
      for (const line of invoice.lines) {
        if (line.kind !== 'medication' || !line.medication_id) continue;
        const price = allocated.lines.find((row) => row.id === line.id);
        if (price)
          invoice_prices.push({
            purchase_id: invoice.id,
            purchase_item_id: line.id,
            medication_id: line.medication_id,
            unit_cost: price.landed_unit,
            currency: invoice.currency,
          });
      }
    }
    const result = buildMedicationVialCostEstimates({
      vials: facts.vials,
      invoice_prices,
      prescriptions: facts.prescriptions,
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
