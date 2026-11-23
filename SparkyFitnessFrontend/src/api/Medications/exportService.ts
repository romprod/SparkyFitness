import { apiCall } from '@/api/api';

export type MedicationExportKind =
  'doses' | 'labs' | 'rmr' | 'wearable' | 'journal' | 'bodycomp';

const PATHS: Record<MedicationExportKind, string> = {
  doses: '/v2/medication-exports/doses',
  labs: '/v2/lab-results/export',
  rmr: '/v2/metabolic-tests/export',
  wearable: '/v2/health-exports/wearable',
  journal: '/v2/health-exports/journal',
  bodycomp: '/v2/body-comp-scans/export',
};

/** A CSV of every recorded dose, lab result, RMR test, wearable day or journal day, as one file. */
export const downloadMedicationExport = (
  kind: MedicationExportKind
): Promise<Blob> =>
  apiCall(PATHS[kind], { method: 'GET', responseType: 'blob' });
