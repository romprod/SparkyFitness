import { z } from 'zod';
import {
  medicationCourseSchema,
  medicationCourseDaySchema,
  medicationCourseReviewSchema,
  medicationCourseHandoffCandidateSchema,
  medicationCourseMutationResultSchema,
  medicationCourseHistorySchema,
  medicationCourseDueSchema,
  medicationCourseCycleStateSchema,
  medicationCourseCycleReviewSchema,
  medicationCourseCycleMutationResultSchema,
  medicationCourseTimelineResponseSchema,
  type MedicationCourseCycleReviewInput,
  type MedicationCourseCycleActionInput,
  type MedicationCourseCreateInput,
  type MedicationCourseEditInput,
  type MedicationCourseReviewInput,
  type MedicationCourseReviseInput,
  type MedicationCourseStatusInput,
  type MedicationCourseDeleteInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

const root = '/v2/medication-courses';
const listSchema = z.object({
  courses: z.array(medicationCourseSchema),
  today: medicationCourseDaySchema,
  timezone: z.string(),
});
const handoffSchema = z.object({
  rules: z.array(medicationCourseHandoffCandidateSchema),
  today: medicationCourseDaySchema,
  timezone: z.string(),
});
export const listMedicationCourses = async (
  medicationId: string | undefined,
  signal?: AbortSignal
) =>
  listSchema.parse(
    await apiCall(root, {
      method: 'GET',
      params: { medication_id: medicationId },
      signal,
      suppressErrorToast: true,
    })
  );
export const getCourseHandoffRules = async (
  medicationId: string,
  signal?: AbortSignal
) =>
  handoffSchema.parse(
    await apiCall(`${root}/medications/${medicationId}/handoff-rules`, {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );
export const reviewMedicationCourse = async (
  medicationId: string,
  courseId: string | null,
  body: MedicationCourseReviewInput,
  signal?: AbortSignal
) =>
  medicationCourseReviewSchema.parse(
    await apiCall(
      courseId
        ? `${root}/${courseId}/review`
        : `${root}/medications/${medicationId}/create-review`,
      { method: 'POST', body, signal, suppressErrorToast: true }
    )
  );
export const createMedicationCourse = async (
  body: MedicationCourseCreateInput
) =>
  medicationCourseMutationResultSchema.parse(
    await apiCall(root, { method: 'POST', body, suppressErrorToast: true })
  );
export const editMedicationCourse = async (
  id: string,
  body: MedicationCourseEditInput
) =>
  medicationCourseMutationResultSchema.parse(
    await apiCall(`${root}/${id}`, {
      method: 'PUT',
      body,
      suppressErrorToast: true,
    })
  );
export const reviseMedicationCourse = async (
  id: string,
  body: MedicationCourseReviseInput
) =>
  medicationCourseMutationResultSchema.parse(
    await apiCall(`${root}/${id}/revise`, {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );
export const setMedicationCourseStatus = async (
  id: string,
  body: MedicationCourseStatusInput
) =>
  medicationCourseMutationResultSchema.parse(
    await apiCall(`${root}/${id}/status`, {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );
export const deleteMedicationCourse = async (
  id: string,
  revisionId: string | null,
  body: MedicationCourseDeleteInput
) =>
  medicationCourseMutationResultSchema.parse(
    await apiCall(
      revisionId ? `${root}/${id}/revisions/${revisionId}` : `${root}/${id}`,
      { method: 'DELETE', body, suppressErrorToast: true }
    )
  );

export const getMedicationCourseHistory = async (
  id: string,
  signal?: AbortSignal
) =>
  medicationCourseHistorySchema.parse(
    await apiCall(`${root}/${id}/history`, {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );
export const getMedicationCourseDue = async (
  date: string,
  signal?: AbortSignal
) =>
  medicationCourseDueSchema.parse(
    await apiCall(`${root}/due`, {
      method: 'GET',
      params: { date },
      signal,
      suppressErrorToast: true,
    })
  );

/** Advisory cycle state and explicit reviewed actions; dates remain server-derived. */
export const getMedicationCourseCycle = async (
  id: string,
  signal?: AbortSignal
) =>
  medicationCourseCycleStateSchema.parse(
    await apiCall(`${root}/${id}/cycle`, {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );
export const reviewMedicationCourseCycle = async (
  id: string,
  body: MedicationCourseCycleReviewInput,
  signal?: AbortSignal
) =>
  medicationCourseCycleReviewSchema.parse(
    await apiCall(`${root}/${id}/cycle-review`, {
      method: 'POST',
      body,
      signal,
      suppressErrorToast: true,
    })
  );
export const endMedicationCourseCycle = async (
  id: string,
  body: MedicationCourseCycleActionInput
) =>
  medicationCourseCycleMutationResultSchema.parse(
    await apiCall(`${root}/${id}/cycle-end`, {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );
export const startMedicationCourseCycle = async (
  id: string,
  body: MedicationCourseCycleActionInput
) =>
  medicationCourseCycleMutationResultSchema.parse(
    await apiCall(`${root}/${id}/cycle-start`, {
      method: 'POST',
      body,
      suppressErrorToast: true,
    })
  );

/** All-profile authored windows; the server supplies the fixed calendar geometry. */
export const getMedicationCourseTimeline = async (
  ownerId: string,
  signal?: AbortSignal
) =>
  medicationCourseTimelineResponseSchema.parse(
    await apiCall(`${root}/timeline`, {
      method: 'GET',
      params: { expected_owner_id: ownerId },
      signal,
      suppressErrorToast: true,
    })
  );
