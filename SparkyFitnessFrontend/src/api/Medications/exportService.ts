import { apiCall } from '@/api/api';

export type MedicationExportKind = 'doses' | 'labs' | 'rmr';

const PATHS: Record<MedicationExportKind, string> = {
  doses: '/v2/medication-exports/doses',
  labs: '/v2/lab-results/export',
  rmr: '/v2/metabolic-tests/export',
};

/** A CSV of every recorded dose, lab result or RMR test, as one file to save. */
export const downloadMedicationExport = (
  kind: MedicationExportKind
): Promise<Blob> =>
  apiCall(PATHS[kind], { method: 'GET', responseType: 'blob' });
