import {
  ecgImportResponseSchema,
  ecgRecordingDetailResponseSchema,
  ecgRecordingListSchema,
  type EcgImportOutcome,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export const listEcgRecordings = async (signal?: AbortSignal) =>
  ecgRecordingListSchema.parse(
    await apiCall('/v2/ecg-recordings', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

/** One recording with its trace. A recording that is not there is a 404 (an HttpApiError). */
export const getEcgRecording = async (id: string, signal?: AbortSignal) =>
  ecgRecordingDetailResponseSchema.parse(
    await apiCall(`/v2/ecg-recordings/${id}`, {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

/**
 * Sends ONE report in its own request. Sparky's proxy refuses any request body over 10 MB, so a
 * batch is sent file by file, never as one multipart body.
 */
export const importEcgReport = async (
  file: File
): Promise<EcgImportOutcome> => {
  const form = new FormData();
  form.append('files', file);
  const { outcomes } = ecgImportResponseSchema.parse(
    await apiCall('/v2/ecg-recordings/import', {
      method: 'POST',
      body: form,
      isFormData: true,
      suppressErrorToast: true,
    })
  );
  return (
    outcomes[0] ?? {
      file: file.name,
      status: 'failed',
      message: 'The server sent back nothing for this file.',
    }
  );
};

/** Deletes the recording and its stored PDF. */
export const deleteEcgRecording = (id: string): Promise<void> =>
  apiCall(`/v2/ecg-recordings/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });
