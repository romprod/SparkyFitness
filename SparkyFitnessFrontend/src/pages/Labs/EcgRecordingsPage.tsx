import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEcgRecordings } from '@/hooks/Labs/useEcgRecordings';
import EcgImport from './EcgImport';
import { EcgHistoryRow, EcgRecordingWithTrace } from './EcgRecordingCard';

/** Every imported ECG recording, newest first. The newest is drawn in full; the rest are rows. */
export default function EcgRecordingsPage() {
  const { t } = useTranslation();
  const { data, isError, isLoading } = useEcgRecordings();
  const recordings = data ?? [];
  const latest = recordings[0];
  const earlier = recordings.slice(1);

  return (
    <main className="mx-auto max-w-5xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/labs">
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('labs.ecg.backToLabs', 'Back to Labs')}
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('labs.ecg.title', 'ECG')}
        </h1>
        <p className="text-muted-foreground">
          {recordings.length === 0
            ? t(
                'labs.ecg.pageSubtitleEmpty',
                'Single-lead recordings imported from Garmin Connect.'
              )
            : recordings.length === 1
              ? t(
                  'labs.ecg.pageSubtitleOne',
                  '1 recording imported from Garmin Connect.'
                )
              : t(
                  'labs.ecg.pageSubtitleMany',
                  '{{count}} recordings imported from Garmin Connect.',
                  { count: recordings.length }
                )}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">
          {t('labs.ecg.loadFailed', 'Could not load your ECG recordings.')}
        </p>
      ) : latest ? (
        <section>
          <h2 className="mb-2 text-lg font-medium">
            {t('labs.ecg.mostRecent', 'Most recent')}
          </h2>
          <EcgRecordingWithTrace
            recording={latest}
            detailHref={`/labs/ecg/${latest.id}`}
          />
        </section>
      ) : (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-sm font-medium">
            {t('labs.ecg.nothingImported', 'Nothing imported yet')}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {t(
              'labs.ecg.nothingImportedBody',
              'Open the recording in Garmin Connect, share it as a PDF, and bring the file here.'
            )}
          </p>
        </div>
      )}

      {earlier.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-medium">
            {t('labs.ecg.earlierShort', 'Earlier')}
          </h2>
          <ul className="divide-y rounded-lg border px-4">
            {earlier.map((r) => (
              <EcgHistoryRow key={r.id} recording={r} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-medium">
          {t('labs.ecg.importHeading', 'Import')}
        </h2>
        <EcgImport />
      </section>
    </main>
  );
}
