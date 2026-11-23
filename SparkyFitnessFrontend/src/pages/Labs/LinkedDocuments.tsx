import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useHealthDocuments,
  useOpenHealthDocumentMutation,
} from '@/hooks/Labs/useHealthDocuments';

/**
 * The stored originals tied to one DEXA scan or RMR test, each opened from here, so the figures
 * typed in can be checked against the paper. Shows nothing when there are none.
 */
export default function LinkedDocuments({
  bodyCompScanId,
  metabolicTestId,
}: {
  bodyCompScanId?: string;
  metabolicTestId?: string;
}) {
  const { t } = useTranslation();
  const { data } = useHealthDocuments();
  const open = useOpenHealthDocumentMutation();
  const [error, setError] = useState<string | null>(null);
  const linked = (data ?? []).filter((doc) =>
    bodyCompScanId
      ? doc.body_comp_scan_id === bodyCompScanId
      : metabolicTestId
        ? doc.metabolic_test_id === metabolicTestId
        : false
  );
  if (linked.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">
        {t('labs.documents.original', 'Original report')}
      </p>
      <ul className="space-y-0.5">
        {linked.map((doc) => (
          <li
            key={doc.id}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <FileText
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <span className="break-all">{doc.label || doc.original_name}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                setError(null);
                open
                  .mutateAsync(doc)
                  .catch((failure) =>
                    setError(
                      failure instanceof Error
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
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
