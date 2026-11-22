import { apiCall } from '@/api/api';

export type MedicationExportKind = 'doses' | 'labs';

const PATHS: Record<MedicationExportKind, string> = {
  doses: '/v2/medication-exports/doses',
  labs: '/v2/lab-results/export',
};

/** A CSV of every recorded dose or lab result, as one file to save. */
export const downloadMedicationExport = (
  kind: MedicationExportKind
): Promise<Blob> =>
  apiCall(PATHS[kind], { method: 'GET', responseType: 'blob' });
