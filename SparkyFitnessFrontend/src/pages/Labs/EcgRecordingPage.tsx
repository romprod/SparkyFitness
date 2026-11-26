import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { isEcgNotFound } from '@/hooks/Labs/ecgImportModel';
import {
  useDeleteEcgRecordingMutation,
  useEcgRecording,
} from '@/hooks/Labs/useEcgRecordings';
import { EcgRecordingCard } from './EcgRecordingCard';
import { formatRecordedAt } from './ecgFormat';

/**
 * One imported ECG recording, in full: Garmin's findings, the trace redrawn, the report itself,
 * and where the record came from. The provenance block exists because the report reader depends
 * on a fixed page layout; the PDF template version tells a row that still reads from one that
 * does not.
 */
export default function EcgRecordingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: recording, error, isLoading } = useEcgRecording(id);
  const remove = useDeleteEcgRecordingMutation();
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link to="/labs/ecg">
        <ArrowLeft className="mr-1 h-4 w-4" />
        {t('labs.ecg.backToAll', 'All ECG recordings')}
      </Link>
    </Button>
  );

  if (isLoading)
    return (
      <main className="mx-auto max-w-5xl space-y-4">
        {back}
        <Skeleton className="h-48 w-full" />
      </main>
    );

  if (!recording) {
    const notFound = isEcgNotFound(error);
    return (
      <main className="mx-auto max-w-5xl space-y-4">
        {back}
        <p className="text-sm" role={notFound ? undefined : 'alert'}>
          {notFound
            ? t('labs.ecg.notFound', 'This ECG recording was not found.')
            : t('labs.ecg.loadOneFailed', 'Could not load this ECG recording.')}
        </p>
      </main>
    );
  }

  const when = formatRecordedAt(recording.recorded_at, recording.tz);
  const notPrinted = t('labs.ecg.notPrinted', 'not printed');
  const provenance: { key: string; label: string; value: string }[] = [
    {
      key: 'recorded',
      label: t('labs.ecg.provRecorded', 'Recorded'),
      value: `${when} (${recording.tz})`,
    },
    {
      key: 'device',
      label: t('labs.ecg.provDevice', 'Device'),
      value:
        [recording.device_model, recording.device_software]
          .filter(Boolean)
          .join(' · ') || notPrinted,
    },
    {
      key: 'scale',
      label: t('labs.ecg.provScale', 'Scale'),
      value:
        recording.paper_speed_mm_s && recording.gain_mm_mv
          ? `${recording.paper_speed_mm_s} mm/s, ${recording.gain_mm_mv} mm/mV`
          : notPrinted,
    },
    {
      key: 'template',
      label: t('labs.ecg.provTemplate', 'PDF template'),
      value: recording.pdf_template_version ?? notPrinted,
    },
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-4">
      {back}
      <div className="space-y-1">
        <h1 className="break-words text-2xl font-semibold tracking-tight">
          {recording.result}
        </h1>
        <p className="text-sm text-muted-foreground">{when}</p>
      </div>

      <EcgRecordingCard
        recording={recording}
        waveform={recording.waveform}
        headingLevel={2}
      />

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">
          {t('labs.ecg.whereFrom', 'Where this came from')}
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {provenance.map((p) => (
            <div key={p.key} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {p.label}
              </dt>
              <dd className="break-words text-sm">{p.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {t(
            'labs.ecg.provCaption',
            "Read from the report as it was printed. The app prints Garmin's wording and adds nothing to it."
          )}
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={remove.isPending}
          onClick={() => {
            setDeleteError(null);
            setConfirming(true);
          }}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          {t('labs.ecg.deleteRecording', 'Delete recording')}
        </Button>
        {deleteError && (
          <p className="text-sm text-destructive" role="alert">
            {deleteError}
          </p>
        )}
      </div>

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('labs.ecg.deleteTitle', 'Delete this ECG recording?')}
        description={t(
          'labs.ecg.deleteDescription',
          "The recording and Garmin's stored PDF will be removed. This cannot be undone."
        )}
        variant="destructive"
        confirmLabel={t('labs.ecg.delete', 'Delete')}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate(recording.id, {
            onSuccess: () => navigate('/labs/ecg', { replace: true }),
            onError: () =>
              setDeleteError(
                t('labs.ecg.deleteFailed', 'Could not delete this recording.')
              ),
          });
        }}
      />
    </main>
  );
}
