import {
  ECG_IMPORT_MAX_FILES,
  ECG_IMPORT_MAX_FILE_BYTES,
  type EcgImportOutcome,
} from '@workspace/shared';
import { HttpApiError } from '@/api/api';

export const ECG_TOO_MANY_MESSAGE = `Import at most ${ECG_IMPORT_MAX_FILES} reports at a time.`;
export const ECG_TOO_LARGE_MESSAGE = 'This file is larger than 10 MB.';
export const ECG_NOT_PDF_MESSAGE =
  'This is not a PDF. Export the ECG from Garmin Connect as a PDF.';
export const ECG_REQUEST_FAILED_MESSAGE =
  'The import did not finish. Please try again.';

/** A 404 from the server: the recording is not there (or is not this profile's). */
export const isEcgNotFound = (error: unknown): boolean =>
  error instanceof HttpApiError && error.status === 404;

export const isPdfFile = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const failed = (file: File, message: string): EcgImportOutcome => ({
  file: file.name,
  status: 'failed',
  message,
});

/** What a request that failed outright says about its file. */
export const requestFailureMessage = (error: unknown): string => {
  if (error instanceof HttpApiError) {
    if (error.status === 413) return ECG_TOO_LARGE_MESSAGE;
    return error.message || ECG_REQUEST_FAILED_MESSAGE;
  }
  return ECG_REQUEST_FAILED_MESSAGE;
};

/**
 * Imports the chosen files one request at a time, in the order given, and reports each outcome as
 * it arrives. Nothing is sent for more than ECG_IMPORT_MAX_FILES files. A file that is not a PDF
 * or is over 10 MB becomes a failed outcome without being sent; a request that fails outright
 * becomes a failed outcome for that file and the rest carry on.
 */
export async function runEcgImport(
  files: File[],
  send: (file: File) => Promise<EcgImportOutcome>,
  onOutcome: (outcome: EcgImportOutcome) => void
): Promise<{ error: string | null; outcomes: EcgImportOutcome[] }> {
  if (files.length > ECG_IMPORT_MAX_FILES)
    return { error: ECG_TOO_MANY_MESSAGE, outcomes: [] };
  const outcomes: EcgImportOutcome[] = [];
  const report = (outcome: EcgImportOutcome) => {
    outcomes.push(outcome);
    onOutcome(outcome);
  };
  for (const file of files) {
    if (!isPdfFile(file)) {
      report(failed(file, ECG_NOT_PDF_MESSAGE));
      continue;
    }
    if (file.size > ECG_IMPORT_MAX_FILE_BYTES) {
      report(failed(file, ECG_TOO_LARGE_MESSAGE));
      continue;
    }
    try {
      report(await send(file));
    } catch (error) {
      report(failed(file, requestFailureMessage(error)));
    }
  }
  return { error: null, outcomes };
}

export const countAdded = (outcomes: EcgImportOutcome[]) =>
  outcomes.filter((o) => o.status === 'imported' || o.status === 'updated')
    .length;
