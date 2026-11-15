import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import {
  addDays,
  compareDays,
  instantToDay,
  isDayString,
  isValidTimeZone,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useAppointmentReport } from '@/hooks/Reports/useAppointmentReport';

function reportTimezone(preferred: string): string {
  if (preferred && isValidTimeZone(preferred)) return preferred;
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browser && isValidTimeZone(browser) ? browser : 'UTC';
}
function defaultRange(timezone: string, now: Date) {
  const to = instantToDay(now, timezone);
  return { from: addDays(to, -90), to };
}
function PdfRangeForm({
  report,
}: {
  report: ReturnType<typeof useAppointmentReport>;
}) {
  const { t } = useTranslation();
  const { timezone: preferredTimezone } = usePreferences();
  const timezone = reportTimezone(preferredTimezone);
  const [now] = useState(() => new Date());
  const [editedRange, setEditedRange] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const range = editedRange ?? defaultRange(timezone, now);
  const realDates = isDayString(range.from) && isDayString(range.to);
  const reversed = realDates && compareDays(range.from, range.to) > 0;
  const valid = realDates && !reversed;
  return (
    <section
      className="space-y-3 border-t pt-4"
      aria-labelledby="appointment-pdf-title"
    >
      <h4 id="appointment-pdf-title" className="font-medium">
        {t(
          'medications.reports.appointmentPdf.title',
          'Appointment report (PDF)'
        )}
      </h4>
      <p
        id="appointment-pdf-description"
        className="text-sm text-muted-foreground"
      >
        {t(
          'medications.reports.appointmentPdf.description',
          'Dose log, symptoms and wellness for this PDF period, plus the latest three explicit lab panels regardless of period.'
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="appointment-pdf-from">
            {t('medications.reports.appointmentPdf.from', 'PDF from')}
          </Label>
          <Input
            id="appointment-pdf-from"
            type="date"
            value={range.from}
            max={range.to || undefined}
            disabled={report.pending}
            aria-invalid={!valid}
            aria-describedby={
              !valid ? 'appointment-pdf-range-error' : undefined
            }
            onChange={(event) => {
              const value = event.target.value;
              setEditedRange((previous) => ({
                ...(previous ?? range),
                from: value,
              }));
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appointment-pdf-to">
            {t('medications.reports.appointmentPdf.to', 'PDF to')}
          </Label>
          <Input
            id="appointment-pdf-to"
            type="date"
            value={range.to}
            min={range.from || undefined}
            disabled={report.pending}
            aria-invalid={!valid}
            aria-describedby={
              !valid ? 'appointment-pdf-range-error' : undefined
            }
            onChange={(event) => {
              const value = event.target.value;
              setEditedRange((previous) => ({
                ...(previous ?? range),
                to: value,
              }));
            }}
          />
        </div>
      </div>
      {!valid && (
        <p
          id="appointment-pdf-range-error"
          role="alert"
          className="text-sm text-foreground"
        >
          {reversed
            ? t(
                'medications.reports.appointmentPdf.reversed',
                'PDF from must be on or before PDF to.'
              )
            : t(
                'medications.reports.appointmentPdf.invalid',
                'Enter valid PDF from and PDF to dates.'
              )}
        </p>
      )}
      <Button
        type="button"
        disabled={!valid || report.pending}
        onClick={() => {
          if (valid) void report.download({ ...range, timezone });
        }}
        aria-describedby="appointment-pdf-description"
      >
        <Download className="mr-2 h-4 w-4" />
        {report.pending
          ? t('medications.reports.appointmentPdf.pending', 'Preparing PDF…')
          : t('medications.reports.appointmentPdf.download', 'Download PDF')}
      </Button>
      {report.failed && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          {t(
            'medications.reports.appointmentPdf.error',
            'Could not download the PDF report. Try again.'
          )}
        </p>
      )}
    </section>
  );
}

export default function AppointmentPdfExport() {
  const report = useAppointmentReport();
  return report.ready ? (
    <PdfRangeForm key={report.generation} report={report} />
  ) : null;
}
