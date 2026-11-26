import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EcgImportOutcome } from '@workspace/shared';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  deleteEcgRecording,
  getEcgRecording,
  importEcgReport,
  listEcgRecordings,
} from '@/api/Labs/ecgRecordingService';
import { countAdded, runEcgImport } from './ecgImportModel';

export const ecgKeys = {
  all: ['ecg-recordings'] as const,
  list: (userId?: string) => ['ecg-recordings', 'list', { userId }] as const,
  detail: (id: string, userId?: string) =>
    ['ecg-recordings', 'detail', id, { userId }] as const,
};

/** ECG recordings of the active profile, newest first, without their traces. */
export const useEcgRecordings = () => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: ecgKeys.list(activeUserId ?? undefined),
    queryFn: ({ signal }) => listEcgRecordings(signal),
    select: (data) => data.ecg_recordings,
  });
};

/** One recording with its trace. Pass null to hold off until an id is known. */
export const useEcgRecording = (id: string | null | undefined) => {
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: ecgKeys.detail(id ?? '', activeUserId ?? undefined),
    queryFn: ({ signal }) => getEcgRecording(id as string, signal),
    enabled: !!id,
    select: (data) => data.ecg_recording,
  });
};

export const useDeleteEcgRecordingMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEcgRecording(id),
    onSuccess: (_data, id) => {
      // The deleted recording's own query would only 404 again; the lists are what changed.
      client.removeQueries({ queryKey: ['ecg-recordings', 'detail', id] });
      return client.invalidateQueries({ queryKey: ['ecg-recordings', 'list'] });
    },
  });
};

/**
 * Imports Garmin ECG reports one request per file, in order, with the outcomes filling in as each
 * one comes back. The list is refreshed once the run ends if anything was added or refreshed.
 */
export const useEcgImport = () => {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<EcgImportOutcome[] | null>(null);
  const running = useRef(false);

  const start = useCallback(
    async (files: File[]) => {
      if (running.current || files.length === 0) return;
      running.current = true;
      setBusy(true);
      setError(null);
      setOutcomes(null);
      let added = 0;
      try {
        const result = await runEcgImport(files, importEcgReport, (outcome) =>
          setOutcomes((current) => [...(current ?? []), outcome])
        );
        added = countAdded(result.outcomes);
        if (result.error) setError(result.error);
      } finally {
        running.current = false;
        setBusy(false);
        if (added > 0)
          await client.invalidateQueries({ queryKey: ecgKeys.all });
      }
    },
    [client]
  );

  return { start, busy, error, outcomes };
};
