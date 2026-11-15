import { useTranslation } from 'react-i18next';
import { medicationVialLabelMassSchema } from '@workspace/shared';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function VialLabelMassField({
  id,
  value,
  onChange,
  conflictsWithPen = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  conflictsWithPen?: boolean;
}) {
  const { t } = useTranslation();
  const invalid =
    !!value.trim() && !medicationVialLabelMassSchema.safeParse(value).success;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {t('medications.labelMass.label', 'Vial label amount (mg)')}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-help`}
        aria-invalid={invalid || (conflictsWithPen && !!value.trim())}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {t(
          'medications.labelMass.help',
          'Optional total printed on the vial, independent of the dose and preparation content.'
        )}
      </p>
      {(invalid || (conflictsWithPen && !!value.trim())) && (
        <Badge
          variant="destructive"
          className="whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10"
        >
          {conflictsWithPen
            ? t(
                'medications.labelMass.clearForPen',
                'Clear the vial label amount before changing this stock to a pen.'
              )
            : t(
                'medications.labelMass.invalid',
                'Enter a finite positive amount, or leave it blank if unknown.'
              )}
        </Badge>
      )}
    </div>
  );
}
