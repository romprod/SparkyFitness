import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, HeartPulse } from 'lucide-react';
import {
  symptomsLabel,
  type EcgRecordingDetail,
  type EcgRecordingSummary,
} from '@workspace/shared';
import { useEcgRecording } from '@/hooks/Labs/useEcgRecordings';
import { useOpenHealthDocumentMutation } from '@/hooks/Labs/useHealthDocuments';
import EcgTrace from './EcgTrace';
import { formatRecordedAt } from './ecgFormat';

const PILL =
  'inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium';

function Stat({
  label,
  value,
  unit,
  wrap = false,
}: {
  label: string;
  value: string;
  unit?: string | null;
  wrap?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      {/* Values wrap rather than clip. A measurement stays whole so a wrap falls between the
          number and its unit; free text from the report has to break anywhere, or a long symptom
          list pushes the card wider than the screen. */}
      <dd className="flex flex-wrap items-baseline gap-x-1 text-sm font-semibold tabular-nums">
        <span className={wrap ? 'break-words' : 'whitespace-nowrap'}>
          {value}
        </span>
        {unit ? (
          <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

export type EcgTraceState = 'ready' | 'loading' | 'failed';

/**
 * One recording in full: what Garmin found, and the trace it drew. Garmin's words are printed as
 * they are; the app adds no reading of its own.
 *
 * `detailHref` links the heading to the recording's own page. `waveform` is the trace: null means
 * the report's trace could not be read, undefined means it is not in hand (see `traceState`).
 */
export function EcgRecordingCard({
  recording,
  waveform,
  traceState = 'ready',
  headingLevel = 3,
  detailHref,
}: {
  recording: EcgRecordingSummary;
  waveform?: EcgRecordingDetail['waveform'];
  traceState?: EcgTraceState;
  headingLevel?: 2 | 3;
  detailHref?: string;
}) {
  const { t } = useTranslation();
  const openDocument = useOpenHealthDocumentMutation();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const when = formatRecordedAt(recording.recorded_at, recording.tz);
  const symptoms = symptomsLabel(recording.symptoms);
  const bpm = recording.avg_heart_rate_bpm;
  const title = (
    <>
      <HeartPulse className="mr-1 inline h-4 w-4 align-[-0.15em]" aria-hidden />
      {recording.result}
    </>
  );

  return (
    <article className="min-w-0 rounded-lg border bg-card p-4 text-card-foreground">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className="text-sm font-semibold">
          {detailHref ? (
            <Link to={detailHref} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        <span className="text-xs tabular-nums text-muted-foreground">
          {when}
        </span>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat
          label={t('labs.ecg.avgHeartRate', 'Average heart rate')}
          value={bpm == null ? '—' : String(bpm)}
          unit={bpm == null ? null : t('labs.ecg.bpm', 'bpm')}
        />
        <Stat
          label={t('labs.ecg.symptoms', 'Symptoms')}
          value={symptoms.text}
          wrap
        />
        <Stat
          label={t('labs.ecg.length', 'Length')}
          value={
            recording.duration_sec == null
              ? '—'
              : String(recording.duration_sec)
          }
          unit={recording.duration_sec == null ? null : 's'}
        />
        <Stat
          label={t('labs.ecg.sampleRate', 'Sample rate')}
          value={
            recording.sample_rate_hz == null
              ? '—'
              : String(recording.sample_rate_hz)
          }
          unit={recording.sample_rate_hz == null ? null : 'Hz'}
        />
      </dl>

      {recording.interpretation && (
        <p className="mb-3 break-words rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {recording.interpretation}
        </p>
      )}

      {traceState === 'loading' ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('labs.ecg.traceLoading', 'Loading the trace…')}
        </p>
      ) : traceState === 'failed' ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('labs.ecg.traceLoadFailed', 'The trace could not be loaded.')}
        </p>
      ) : waveform ? (
        <EcgTrace
          waveform={waveform}
          mmPerSec={recording.paper_speed_mm_s}
          mmPerMv={recording.gain_mm_mv}
          id={`ecg-${recording.id}`}
          label={t(
            'labs.ecg.traceLabel',
            'ECG trace, {{result}}, recorded {{when}}',
            { result: recording.result, when }
          )}
        />
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t(
            'labs.ecg.noTrace',
            'The trace could not be read from this report.'
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground">
        {recording.lead_note && <span>{recording.lead_note}</span>}
        {recording.device_model && (
          <span className={`${PILL} bg-muted text-muted-foreground`}>
            {recording.device_model}
            {recording.device_software ? ` · ${recording.device_software}` : ''}
          </span>
        )}
        {recording.document_id && (
          <button
            type="button"
            disabled={openDocument.isPending}
            onClick={() =>
              openDocument.mutate({
                id: recording.document_id as string,
                original_name: 'garmin-ecg-report.pdf',
              })
            }
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-60"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {t('labs.ecg.ownReport', "Garmin's own report (PDF)")}
          </button>
        )}
        {openDocument.isError && (
          <span role="alert" className="text-destructive">
            {t('labs.ecg.openFailed', 'The report could not be opened.')}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * A recording drawn in full, its trace fetched by id because the list carries none. Nothing is
 * fetched for a recording whose report had no readable trace.
 */
export function EcgRecordingWithTrace({
  recording,
  headingLevel,
  detailHref,
}: {
  recording: EcgRecordingSummary;
  headingLevel?: 2 | 3;
  detailHref?: string;
}) {
  const detail = useEcgRecording(recording.has_waveform ? recording.id : null);
  const traceState: EcgTraceState = !recording.has_waveform
    ? 'ready'
    : detail.isError
      ? 'failed'
      : detail.data
        ? 'ready'
        : 'loading';
  return (
    <EcgRecordingCard
      recording={recording}
      waveform={recording.has_waveform ? (detail.data?.waveform ?? null) : null}
      traceState={traceState}
      headingLevel={headingLevel}
      detailHref={detailHref}
    />
  );
}

/** A recording that is not the one drawn: one row, linking to its own page. */
export function EcgHistoryRow({
  recording,
}: {
  recording: EcgRecordingSummary;
}) {
  const { t } = useTranslation();
  const symptoms = symptomsLabel(recording.symptoms);
  return (
    <li>
      <Link
        to={`/labs/ecg/${recording.id}`}
        className="-mx-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md px-2 py-2 hover:bg-muted/50"
      >
        <span className="min-w-0 break-words text-sm font-medium">
          {recording.result}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3 text-xs tabular-nums text-muted-foreground">
          {recording.avg_heart_rate_bpm != null && (
            <span>
              {recording.avg_heart_rate_bpm} {t('labs.ecg.bpm', 'bpm')}
            </span>
          )}
          {symptoms.reported && (
            <span
              className={`${PILL} max-w-[12rem] truncate bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200`}
            >
              {symptoms.text}
            </span>
          )}
          <span>{formatRecordedAt(recording.recorded_at, recording.tz)}</span>
        </span>
      </Link>
    </li>
  );
}
