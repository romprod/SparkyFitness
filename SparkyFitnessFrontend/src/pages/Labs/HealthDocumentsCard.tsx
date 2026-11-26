import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Trash2, Upload } from 'lucide-react';
import {
  HEALTH_DOCUMENT_KINDS,
  HEALTH_DOCUMENT_MAX_BYTES,
  type HealthDocument,
  type HealthDocumentKind,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useBodyCompScans } from '@/hooks/Labs/useBodyCompScans';
import {
  useDeleteHealthDocumentMutation,
  useHealthDocuments,
  useOpenHealthDocumentMutation,
  useUploadHealthDocumentMutation,
} from '@/hooks/Labs/useHealthDocuments';
import { useMetabolicTests } from '@/hooks/Labs/useMetabolicTests';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
const ACCEPTED = /\.(pdf|jpe?g|png|gif|webp)$/i;

/**
 * ECG reports arrive through the ECG import, which reads the PDF and links it to its recording.
 * One filed by hand would be a PDF no recording owns, so the picker does not offer it; the kind
 * still has a label so an imported one reads properly in the list.
 */
const PICKABLE_KINDS = HEALTH_DOCUMENT_KINDS.filter(
  (value) => value !== 'ecg_report'
);

const KIND_FALLBACK: Record<HealthDocumentKind, string> = {
  prescription: 'Prescription',
  lab_report: 'Lab report',
  dexa_report: 'DEXA report',
  rmr_report: 'RMR report',
  ecg_report: 'ECG report',
  other: 'Other',
};

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Stored originals, as Pitstop keeps them: the PDF or photo a report was made from, kept as it was
 * uploaded beside the figures typed from it. A document can be tied to a DEXA scan or an RMR test
 * and is kept if that record is deleted. The same file is never stored twice.
 */
export default function HealthDocumentsCard() {
  const { t } = useTranslation();
  const { formatDate } = usePreferences();
  const { data, isError } = useHealthDocuments();
  const scans = useBodyCompScans().data ?? [];
  const tests = useMetabolicTests().data ?? [];
  const upload = useUploadHealthDocumentMutation();
  const remove = useDeleteHealthDocumentMutation();
  const open = useOpenHealthDocumentMutation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<HealthDocumentKind>('lab_report');
  const [label, setLabel] = useState('');
  const [day, setDay] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<HealthDocument | null>(null);
  const documents = data ?? [];

  const kindLabel = (value: HealthDocumentKind) =>
    t(`labs.documents.kind.${value}`, KIND_FALLBACK[value]);
  const linkedTo = (doc: HealthDocument): string | null => {
    const scan = doc.body_comp_scan_id
      ? scans.find((s) => s.id === doc.body_comp_scan_id)
      : null;
    if (scan)
      return t('labs.documents.linkedScan', 'DEXA scan of {{date}}', {
        date: formatDate(scan.scanned_day),
      });
    const test = doc.metabolic_test_id
      ? tests.find((x) => x.id === doc.metabolic_test_id)
      : null;
    if (test)
      return t('labs.documents.linkedTest', 'RMR test of {{date}}', {
        date: formatDate(test.tested_day),
      });
    return null;
  };

  function reset() {
    setAdding(false);
    setFile(null);
    setKind('lab_report');
    setLabel('');
    setDay('');
    setLink('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(submitted: React.FormEvent) {
    submitted.preventDefault();
    setError(null);
    if (!file) {
      setError(t('labs.documents.chooseFile', 'Choose a file to store.'));
      return;
    }
    if (!ACCEPTED.test(file.name)) {
      setError(
        t(
          'labs.documents.wrongType',
          'Choose a PDF or an image (jpeg, png, webp or gif).'
        )
      );
      return;
    }
    if (file.size > HEALTH_DOCUMENT_MAX_BYTES) {
      setError(
        t(
          'labs.documents.tooBig',
          'That file is too large: {{max}} MB at most.',
          { max: HEALTH_DOCUMENT_MAX_BYTES / 1024 / 1024 }
        )
      );
      return;
    }
    const [linkKind, linkId] = link.split(':');
    try {
      await upload.mutateAsync({
        file,
        fields: {
          kind,
          label: label.trim(),
          document_day: day,
          body_comp_scan_id: linkKind === 'scan' ? (linkId ?? '') : '',
          metabolic_test_id: linkKind === 'test' ? (linkId ?? '') : '',
        },
      });
      reset();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : t(
              'labs.documents.saveFailed',
              'Could not store the file. Please try again.'
            )
      );
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4" />
            {t('labs.documents.title', 'Stored originals')}
          </CardTitle>
          {!adding && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t('labs.documents.add', 'Store a report')}
            </Button>
          )}
        </div>
        <CardDescription className="text-xs">
          {t(
            'labs.documents.intro',
            'Keep the PDF or photo of a report beside the figures typed from it, so they can be checked against the paper. Files stay on your own server and open only for you and anyone you have given check-in access.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {adding && (
          <form
            onSubmit={submit}
            className="space-y-3 rounded-md border p-4"
            aria-label={t('labs.documents.formLabel', 'Store a report')}
          >
            <div className="space-y-1">
              <Label htmlFor="doc-file">
                {t('labs.documents.file', 'File (PDF or image, up to 15 MB)')}
              </Label>
              <Input
                id="doc-file"
                ref={fileInput}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="doc-kind">
                  {t('labs.documents.kindLabel', 'What it is')}
                </Label>
                <select
                  id="doc-kind"
                  className={SELECT_CLASS}
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as HealthDocumentKind)
                  }
                >
                  {PICKABLE_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {kindLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="doc-label">
                  {t('labs.documents.labelLabel', 'Label (optional)')}
                </Label>
                <Input
                  id="doc-label"
                  value={label}
                  maxLength={100}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="doc-day">
                  {t('labs.documents.dayLabel', 'Report date (optional)')}
                </Label>
                <Input
                  id="doc-day"
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="doc-link">
                  {t('labs.documents.linkLabel', 'Attach to (optional)')}
                </Label>
                <select
                  id="doc-link"
                  className={SELECT_CLASS}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                >
                  <option value="">
                    {t('labs.documents.noLink', 'No record')}
                  </option>
                  {scans.map((scan) => (
                    <option key={scan.id} value={`scan:${scan.id}`}>
                      {t('labs.documents.linkedScan', 'DEXA scan of {{date}}', {
                        date: formatDate(scan.scanned_day),
                      })}
                    </option>
                  ))}
                  {tests.map((test) => (
                    <option key={test.id} value={`test:${test.id}`}>
                      {t('labs.documents.linkedTest', 'RMR test of {{date}}', {
                        date: formatDate(test.tested_day),
                      })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={upload.isPending}>
                {upload.isPending
                  ? t('labs.documents.storing', 'Storing…')
                  : t('labs.documents.store', 'Store file')}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                {t('labs.documents.cancel', 'Cancel')}
              </Button>
            </div>
          </form>
        )}
        {!adding && error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {isError && (
          <p className="text-xs text-muted-foreground">
            {t('labs.documents.loadFailed', 'Could not load the stored files.')}
          </p>
        )}
        {!isError && documents.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground">
            {t(
              'labs.documents.empty',
              'Nothing stored yet. Store a lab, DEXA, RMR or prescription report to keep the original.'
            )}
          </p>
        )}
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {doc.label || doc.original_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    kindLabel(doc.kind),
                    doc.document_day ? formatDate(doc.document_day) : null,
                    sizeText(doc.size_bytes),
                    linkedTo(doc),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {doc.label && (
                    <span className="block break-all">{doc.original_name}</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    open
                      .mutateAsync(doc)
                      .catch((failure) =>
                        setError(
                          failure instanceof Error && failure.message
                            ? failure.message
                            : t(
                                'labs.documents.openFailed',
                                'Could not open the document.'
                              )
                        )
                      );
                  }}
                >
                  {t('labs.documents.open', 'Open')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={t('labs.documents.deleteOne', 'Delete {{name}}', {
                    name: doc.label || doc.original_name,
                  })}
                  onClick={() => setDeleting(doc)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('labs.documents.deleteTitle', 'Delete this file?')}
        description={t(
          'labs.documents.deleteDescription',
          'The stored original is removed from the server. The figures typed from it are kept. This cannot be undone.'
        )}
        variant="destructive"
        confirmLabel={t('labs.documents.delete', 'Delete')}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          setError(null);
          if (target)
            remove.mutate(target.id, {
              onError: (failure) =>
                setError(
                  failure instanceof Error && failure.message
                    ? failure.message
                    : t(
                        'labs.documents.deleteFailed',
                        'Could not delete the file. Please try again.'
                      )
                ),
            });
        }}
      />
    </Card>
  );
}
