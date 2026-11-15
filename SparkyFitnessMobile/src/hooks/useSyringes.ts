import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DrawPreviewInput } from '@workspace/shared';
import {
  deleteSyringe,
  listSyringes,
  previewSyringeDraw,
  saveSyringe,
  setDefaultSyringe,
} from '../services/api/syringesApi';
import { useRefetchOnFocus } from './useRefetchOnFocus';

const syringeKey = ['medications', 'syringes'] as const;
export function useSyringes() {
  const query = useQuery({ queryKey: syringeKey, queryFn: listSyringes });
  useRefetchOnFocus(query.refetch);
  return query;
}
export function useSyringeMutations() {
  const client = useQueryClient();
  const onSuccess = () => {
    void client.invalidateQueries({ queryKey: syringeKey });
    void client.invalidateQueries({ queryKey: ['medications', 'drawPreview'] });
  };
  return {
    save: useMutation({ mutationFn: saveSyringe, onSuccess }),
    remove: useMutation({ mutationFn: deleteSyringe, onSuccess }),
    setDefault: useMutation({ mutationFn: setDefaultSyringe, onSuccess }),
  };
}
export function useSyringeDrawPreview(
  penId: string | null,
  input: DrawPreviewInput | null,
  context?: string
) {
  return useQuery({
    queryKey: ['medications', 'drawPreview', penId, input, context],
    queryFn: ({ signal }) => previewSyringeDraw(penId!, input!, signal),
    enabled: !!penId && !!input,
    // Every preview rechecks the current stock, including on returning to this screen.
    staleTime: 0,
    placeholderData: undefined,
    retry: false,
  });
}
