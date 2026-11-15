import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Plus, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Medication } from '@/types/medications';
import AddMedicationDialog from './AddMedicationDialog';
import Glp1InventoryManager from './Glp1InventoryManager';

/** Shared stock tools for all injectable peptides; no GLP-1 model or flag is required. */
export default function PeptideStock({ meds }: { meds: Medication[] }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const injectables = meds.filter((m) => m.type_id === 'injection');
  const selected =
    injectables.find((m) => m.id === params.get('medication')) ??
    injectables.find((m) => m.is_active) ??
    injectables[0];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            {t('medications.stock.title', 'Preparation & stock')}
          </CardTitle>
          <CardDescription>
            {t(
              'medications.stock.description',
              'Prepare vials, calculate draw volumes and track stock for any injectable peptide or medication. No GLP-1 setting is needed.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {selected && (
              <div className="flex-1 space-y-2">
                <Label htmlFor="stock-medication">
                  {t('medications.stock.select', 'Peptide / medication')}
                </Label>
                <Select
                  value={selected.id}
                  onValueChange={(id) =>
                    setParams((previous) => {
                      const next = new URLSearchParams(previous);
                      next.set('tab', 'stock');
                      next.set('medication', id);
                      return next;
                    })
                  }
                >
                  <SelectTrigger id="stock-medication">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {injectables.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name || m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <AddMedicationDialog
              defaultTypeId="injection"
              trigger={
                <Button variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('medications.stock.add', 'Add peptide / injectable')}
                </Button>
              }
            />
          </div>
          {!selected && (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.stock.empty',
                'Add your peptide as an injection to start. Existing injectable medications appear here automatically.'
              )}
            </p>
          )}
        </CardContent>
      </Card>
      {selected && (
        <div key={selected.id} className="space-y-4">
          <Glp1InventoryManager med={selected} />
        </div>
      )}
    </div>
  );
}
