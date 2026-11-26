import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, Files, RefreshCw, Upload } from 'lucide-react';
import type { EcgImportOutcome } from '@workspace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEcgImport } from '@/hooks/Labs/useEcgRecordings';
import { countAdded } from '@/hooks/Labs/ecgImportModel';

const STATUS: Record<
  EcgImportOutcome['status'],
  { label: string; fallback: string; Icon: typeof Check }
> = {
  imported: { label: 'imported', fallback: 'imported', Icon: Check },
  updated: { label: 'updated', fallback: 'refreshed', Icon: RefreshCw },
  duplicate: { label: 'duplicate', fallback: 'already here', Icon: Files },
  failed: { label: 'failed', fallback: 'not read', Icon: CircleAlert },
};

/**
 * Import control for Garmin ECG reports. Choosing or dropping files IS the import: there is no
 * form and nothing to confirm, because every value is printed on the report. Several files at
 * once is the normal case, and re-importing one already stored refreshes it rather than
 * duplicating it. Files go one request each, in order, so the list below fills in as they land.
 */
export default function EcgImport({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { start, busy, error, outcomes } = useEcgImport();
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const added = outcomes ? countAdded(outcomes) : 0;

  return (
    <div className="min-w-0 space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) void start(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-lg border border-dashed p-4 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'bg-muted/30'
        }`}
      >
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={busy}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="ecg-file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) void start(files);
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" aria-hidden />
          {busy
            ? t('labs.ecg.reading', 'Reading…')
            : t('labs.ecg.import', 'Import ECG reports')}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          {compact
            ? t(
                'labs.ecg.dropHintCompact',
                'PDFs from Garmin Connect. Drop several at once.'
              )
            : t(
                'labs.ecg.dropHint',
                'Garmin Connect → the ECG recording → share it as a PDF. Drop the files here, or choose them. Everything on the report is read for you, so there is nothing to type.'
              )}
        </p>
      </div>

      {/* Live regions are mounted before they have anything to say, so a screen reader announces
          the text when it arrives. */}
      <p className="text-xs text-muted-foreground" role="status">
        {busy ? t('labs.ecg.readingReports', 'Reading the reports…') : ''}
      </p>
      <p className="text-sm text-destructive" role="alert">
        {error ?? ''}
      </p>

      <div role="status" aria-live="polite">
        {outcomes && outcomes.length > 0 && (
          <>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {added > 0
                ? t(
                    'labs.ecg.addedOf',
                    '{{added}} of {{total}} added or refreshed',
                    { added, total: outcomes.length }
                  )
                : t('labs.ecg.checked', '{{total}} checked', {
                    total: outcomes.length,
                  })}
            </p>
            <ul className="space-y-1 text-xs">
              {outcomes.map((o, i) => {
                const s = STATUS[o.status];
                return (
                  <li
                    key={`${o.file}-${i}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                  >
                    <s.Icon
                      className={`h-3.5 w-3.5 shrink-0 translate-y-0.5 ${
                        o.status === 'failed'
                          ? 'text-destructive'
                          : o.status === 'duplicate'
                            ? 'text-muted-foreground'
                            : 'text-green-600 dark:text-green-400'
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 break-words font-medium">
                      {o.file}
                    </span>
                    <Badge
                      variant={
                        o.status === 'failed'
                          ? 'destructive'
                          : o.status === 'duplicate'
                            ? 'outline'
                            : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {t(`labs.ecg.status.${o.status}`, s.fallback)}
                    </Badge>
                    <span className="w-full break-words text-muted-foreground sm:w-auto">
                      {o.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
