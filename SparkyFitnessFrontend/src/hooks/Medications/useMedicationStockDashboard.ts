import { useQuery } from '@tanstack/react-query';
import { getMedicationStockDashboard } from '@/api/Medications/inventoryDashboardService';
import { listPens } from '@/api/Medications/medicationService';
import { medicationInventoryKeys } from '@/api/keys/medicationInventory';
import { useMedicationCourseScope } from './useMedicationCourses';

export const useMedicationStockDashboard = () => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [
      ...medicationInventoryKeys.all,
      scope.key,
      'dashboard',
      'planned_cycles',
    ],
    queryFn: ({ signal }) => getMedicationStockDashboard(scope.ownerId, signal),
    enabled: scope.ready,
    gcTime: Infinity,
  });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
  };
};

/** Expanding a queue row revalidates eligibility and fetches that exact existing record. */
export const usePreparationQueueStock = (
  medicationId: string,
  stockId: string,
  enabled: boolean
) => {
  const scope = useMedicationCourseScope();
  const query = useQuery({
    queryKey: [
      ...medicationInventoryKeys.all,
      scope.key,
      'queue-stock',
      'planned_cycles',
      medicationId,
      stockId,
    ],
    enabled: enabled && scope.ready && scope.canWrite,
    // Every expansion must validate again, even inside the application cache window.
    staleTime: 0,
    refetchOnMount: 'always',
    gcTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!scope.isCurrent() || !scope.canWrite)
        throw new Error('The active profile changed.');
      const dashboard = await getMedicationStockDashboard(
        scope.ownerId,
        signal
      );
      const row = dashboard.preparation_queue.find(
        (item) =>
          item.stock_id === stockId && item.medication_id === medicationId
      );
      if (!row)
        throw new Error(
          'This vial is no longer available in the preparation queue.'
        );
      if (!scope.isCurrent() || !scope.canWrite)
        throw new Error('The active profile changed.');
      const pens = await listPens(medicationId, signal);
      const pen = pens.find(
        (item) => item.id === stockId && item.medication_id === medicationId
      );
      if (!pen || pen.kind !== 'vial' || pen.preparation)
        throw new Error(
          'This stock record is no longer available for preparation.'
        );
      return { row, pen };
    },
  });
  return {
    scope,
    query,
    data: scope.ready && scope.isCurrent() ? query.data : undefined,
  };
};
