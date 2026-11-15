import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  MedicationPreparationReviewInput,
  MedicationPreparationReview,
  MedicationPreparationCorrectionInput,
  MedicationPreparationCorrectionResult,
} from '@workspace/shared';
import { ApiError } from '../services/api/errors';
import i18n from '../localization/i18n';
import { apiFetch } from '../services/api/apiClient';
import { invalidateMedicationEntryCaches } from './invalidateMedicationEntryCaches';

// Active medication observers are removed by the existing identity-change cache
// clear. An old review must never be accepted by a still-mounted form afterwards.
function useReviewScope() {
  const client = useQueryClient();
  const valid = useRef(true);
  const [scopeValid, setScopeValid] = useState(true);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (
          event.type === 'removed' &&
          event.query.queryKey[0] === 'medications' &&
          event.query.getObserversCount() > 0
        ) {
          valid.current = false;
          setScopeValid(false);
        }
      }),
    [client]
  );
  const checkScope = () => {
    if (!valid.current)
      throw new Error(
        i18n.t('medications.preparation.accountChanged', {
          defaultValue: 'The active account changed. Reopen this preparation.',
        })
      );
  };
  return { checkScope, scopeValid };
}

export function usePreparationReview(penId: string) {
  const client = useQueryClient();
  const { checkScope, scopeValid } = useReviewScope();
  const mutation = useMutation({
    mutationFn: async (body: MedicationPreparationReviewInput) => {
      checkScope();
      const result = await apiFetch<MedicationPreparationReview>({
        endpoint: `/api/v2/medications/pens/${penId}/preparation-review`,
        serviceName: 'Preparation API',
        operation: 'review preparation',
        method: 'POST',
        body,
        logResponseBody: false,
      });
      checkScope();
      return result;
    },
    onError: (error) => {
      if (error instanceof ApiError && error.statusCode === 409)
        invalidateMedicationEntryCaches(client);
    },
  });
  return { ...mutation, scopeValid };
}
export function usePreparationCorrection(penId: string) {
  const client = useQueryClient();
  const { checkScope, scopeValid } = useReviewScope();
  const mutation = useMutation({
    mutationFn: async (body: MedicationPreparationCorrectionInput) => {
      checkScope();
      const result = await apiFetch<MedicationPreparationCorrectionResult>({
        endpoint: `/api/v2/medications/pens/${penId}/preparation-corrections`,
        serviceName: 'Preparation API',
        operation: 'correct preparation',
        method: 'POST',
        body,
        logResponseBody: false,
      });
      checkScope();
      return result;
    },
    onError: (error) => {
      if (error instanceof ApiError && error.statusCode === 409)
        invalidateMedicationEntryCaches(client);
    },
    onSuccess: () => invalidateMedicationEntryCaches(client),
  });
  return { ...mutation, scopeValid };
}
