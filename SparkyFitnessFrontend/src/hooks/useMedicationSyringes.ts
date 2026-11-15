import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import i18n from 'i18next';
import type {
  DrawPreviewInput,
  MedicationSyringeInput,
} from '@workspace/shared';
import * as syringeService from '@/api/Medications/syringeService';

const syringeKeys = { all: ['medication-syringes'] as const };
export const useMedicationSyringes = () =>
  useQuery({ queryKey: syringeKeys.all, queryFn: syringeService.listSyringes });
export const useSaveMedicationSyringe = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: MedicationSyringeInput;
    }) =>
      id
        ? syringeService.updateSyringe(id, body)
        : syringeService.createSyringe(body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: syringeKeys.all });
      client.invalidateQueries({ queryKey: ['medication-draw-preview'] });
      client.invalidateQueries({ queryKey: ['medication-injections'] });
    },
    meta: {
      errorMessage: i18n.t(
        'medications.syringes.saveError',
        'Could not save syringe.'
      ),
    },
  });
};
export const useDeleteMedicationSyringe = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: syringeService.deleteSyringe,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: syringeKeys.all });
      client.invalidateQueries({ queryKey: ['medication-draw-preview'] });
      client.invalidateQueries({ queryKey: ['medication-injections'] });
    },
    meta: {
      errorMessage: i18n.t(
        'medications.syringes.deleteError',
        'Could not remove syringe.'
      ),
    },
  });
};
export const useDefaultMedicationSyringe = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: syringeService.setDefaultSyringe,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: syringeKeys.all });
      client.invalidateQueries({ queryKey: ['medication-draw-preview'] });
      client.invalidateQueries({ queryKey: ['medication-injections'] });
    },
    meta: {
      errorMessage: i18n.t(
        'medications.syringes.defaultError',
        'Could not update default syringe.'
      ),
    },
  });
};
export const useMedicationDrawPreview = (
  penId: string | null,
  input: DrawPreviewInput | null
) =>
  useQuery({
    queryKey: ['medication-draw-preview', penId, input],
    queryFn: () => syringeService.previewDraw(penId!, input!),
    enabled: !!penId && !!input,
    staleTime: 0,
    retry: false,
  });
