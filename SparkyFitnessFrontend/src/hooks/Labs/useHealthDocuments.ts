import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HealthDocument } from '@workspace/shared';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  deleteHealthDocument,
  listHealthDocuments,
  openHealthDocument,
  uploadHealthDocument,
} from '@/api/Labs/healthDocumentService';

const documentKeys = {
  all: ['health-documents'] as const,
  list: (userId?: string) => ['health-documents', { userId }] as const,
};

/** The active profile's stored originals, newest first. */
export const useHealthDocuments = () => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: documentKeys.list(activeUserId ?? undefined),
    queryFn: ({ signal }) => listHealthDocuments(signal),
    select: (data) => data.health_documents,
  });
};

const useInvalidate = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: documentKeys.all });
};

export const useUploadHealthDocumentMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      file,
      fields,
    }: {
      file: File;
      fields: Record<string, string>;
    }) => uploadHealthDocument(file, fields),
    onSuccess: invalidate,
  });
};

export const useDeleteHealthDocumentMutation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteHealthDocument(id),
    onSuccess: invalidate,
  });
};

/** Opens a stored original in a new tab; the failure, if any, is the caller's to show. */
export const useOpenHealthDocumentMutation = () =>
  useMutation({
    mutationFn: (doc: HealthDocument) => openHealthDocument(doc),
    meta: { silentError: true },
  });
