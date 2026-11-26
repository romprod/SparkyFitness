import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  MedicationStackScheduleClearInput,
  MedicationStackScheduleReviewInput,
  MedicationStackScheduleSaveInput,
} from '@workspace/shared';
import {
  clearStackSchedule,
  reviewStackSchedule,
  saveStackSchedule,
} from '@/api/Medications/stackService';
import { invalidateMedicationCourses } from './useMedicationCourses';
import { stackKeys } from './useMedicationStacks';

/** A schedule change rewrites plans, so stacks, courses, due doses, the week and logs all refresh. */
const useInvalidateAfterScheduleChange = () => {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: stackKeys.all });
    invalidateMedicationCourses(client);
  };
};

/** Read-only review of what a schedule would do to each member. */
export const useReviewStackScheduleMutation = () =>
  useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: MedicationStackScheduleReviewInput;
    }) => reviewStackSchedule(id, body),
  });

export const useSaveStackScheduleMutation = () => {
  const invalidate = useInvalidateAfterScheduleChange();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: MedicationStackScheduleSaveInput;
    }) => saveStackSchedule(id, body),
    onSuccess: invalidate,
  });
};

export const useClearStackScheduleMutation = () => {
  const invalidate = useInvalidateAfterScheduleChange();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: MedicationStackScheduleClearInput;
    }) => clearStackSchedule(id, body),
    onSuccess: invalidate,
  });
};
