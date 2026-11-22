import { useMutation } from '@tanstack/react-query';
import {
  downloadMedicationExport,
  type MedicationExportKind,
} from '@/api/Medications/exportService';

export type { MedicationExportKind };

export const useDownloadMedicationExport = () =>
  useMutation({
    mutationFn: (kind: MedicationExportKind) => downloadMedicationExport(kind),
  });
