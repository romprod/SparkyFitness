import {
  healthDocumentListSchema,
  healthDocumentSchema,
  type HealthDocument,
} from '@workspace/shared';
import { apiCall } from '@/api/api';
import { saveBlobAs } from '@/utils/saveBlob';

export const listHealthDocuments = async (signal?: AbortSignal) =>
  healthDocumentListSchema.parse(
    await apiCall('/v2/health-documents', {
      method: 'GET',
      signal,
      suppressErrorToast: true,
    })
  );

/** Stores a file with what was said about it; the server reads the real type from the bytes. */
export const uploadHealthDocument = async (
  file: File,
  fields: Record<string, string>
): Promise<HealthDocument> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', file);
  return healthDocumentSchema.parse(
    await apiCall('/v2/health-documents', {
      method: 'POST',
      body: form,
      isFormData: true,
      suppressErrorToast: true,
    })
  );
};

export const deleteHealthDocument = (id: string): Promise<void> =>
  apiCall(`/v2/health-documents/${id}`, {
    method: 'DELETE',
    suppressErrorToast: true,
  });

/**
 * Opens a stored original in a new tab. The file is sent only to a signed-in request, so it is
 * fetched with the session and shown from a local copy rather than linked. The tab is opened
 * first, while the click still counts, and pointed at the file once it arrives; if the browser
 * blocks the tab, the file is offered as a download instead.
 */
export async function openHealthDocument(
  doc: Pick<HealthDocument, 'id' | 'original_name'>
): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const blob = await apiCall(`/v2/health-documents/${doc.id}/file`, {
      method: 'GET',
      responseType: 'blob',
      suppressErrorToast: true,
    });
    if (tab) {
      const url = URL.createObjectURL(blob);
      tab.location.href = url;
      // Long enough for the tab to load it, then let it go.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      saveBlobAs(blob, doc.original_name);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
