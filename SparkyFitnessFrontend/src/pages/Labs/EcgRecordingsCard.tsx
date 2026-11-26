import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HeartPulse } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useEcgRecordings } from '@/hooks/Labs/useEcgRecordings';
import EcgImport from './EcgImport';
import { EcgHistoryRow, EcgRecordingWithTrace } from './EcgRecordingCard';

/** How many earlier recordings the Labs page lists before sending you to all of them. */
export const EARLIER_ROWS = 5;

/**
 * Single-lead ECG recordings imported from Garmin Connect reports. The newest is drawn in full;
 * earlier ones are rows. Everything printed is Garmin's own wording; the app draws the trace and
 * shows the numbers and does not say what any of it means.
 */
export default function EcgRecordingsCard() {
  const { t } = useTranslation();
  const { data, isError, isLoading } = useEcgRecordings();
  const recordings = data ?? [];
  const total = recordings.length;
  const latest = recordings[0];
  const earlier = recordings.slice(1, 1 + EARLIER_ROWS);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartPulse className="h-4 w-4" />
              {t('labs.ecg.title', 'ECG')}
            </CardTitle>
            <CardDescription className="text-xs">
              {total === 0
                ? t(
                    'labs.ecg.subtitleEmpty',
                    'Single-lead recordings from your watch.'
                  )
                : total === 1
                  ? t('labs.ecg.subtitleOne', '1 recording from your watch.')
                  : t(
                      'labs.ecg.subtitleMany',
                      '{{count}} recordings from your watch.',
                      { count: total }
                    )}
            </CardDescription>
          </div>
          {total > 1 && (
            <Link
              to="/labs/ecg"
              className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              {t('labs.ecg.allRecordings', 'All {{count}} recordings', {
                count: total,
              })}{' '}
              →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive" role="alert">
            {t('labs.ecg.loadFailed', 'Could not load your ECG recordings.')}
          </p>
        ) : latest ? (
          <EcgRecordingWithTrace
            recording={latest}
            detailHref={`/labs/ecg/${latest.id}`}
          />
        ) : (
          <div className="rounded-lg border p-6 text-center">
            <p className="text-sm font-medium">
              {t('labs.ecg.emptyTitle', 'No ECG recordings yet')}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {t(
                'labs.ecg.emptyBody',
                'Garmin keeps ECG recordings in the phone app and offers no other way out, so they arrive here as the PDF it shares. Import one below and it is read for you.'
              )}
            </p>
          </div>
        )}

        {earlier.length > 0 && (
          <div className="rounded-lg border p-4">
            <h3 className="mb-1 text-sm font-semibold">
              {t('labs.ecg.earlier', 'Earlier recordings')}
            </h3>
            <ul className="divide-y">
              {earlier.map((r) => (
                <EcgHistoryRow key={r.id} recording={r} />
              ))}
            </ul>
          </div>
        )}

        <EcgImport compact={total > 0} />
      </CardContent>
    </Card>
  );
}
