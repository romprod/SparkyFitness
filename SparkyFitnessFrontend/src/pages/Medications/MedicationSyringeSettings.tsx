import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  medicationSyringeInputSchema,
  type MedicationSyringe,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useMedicationSyringes,
  useSaveMedicationSyringe,
  useDeleteMedicationSyringe,
  useDefaultMedicationSyringe,
} from '@/hooks/useMedicationSyringes';

const blankForm = {
  name: '',
  graduation_type: 'units' as 'units' | 'ml',
  units_per_ml: '100',
  capacity_ml: '1',
  capacity_units: '100',
  increment: '1',
};
type SyringeForm = typeof blankForm & { id?: string };
export default function MedicationSyringeSettings() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SyringeForm | null>(null);
  const syringes = useMedicationSyringes();
  const save = useSaveMedicationSyringe();
  const remove = useDeleteMedicationSyringe();
  const makeDefault = useDefaultMedicationSyringe();
  const busy = save.isPending || remove.isPending || makeDefault.isPending;
  const input = form
    ? medicationSyringeInputSchema.safeParse({
        ...form,
        units_per_ml: Number(form.units_per_ml),
        capacity_units: Number(form.capacity_units),
      })
    : null;
  const edit = (s: MedicationSyringe) =>
    setForm({
      id: s.id,
      name: s.name,
      graduation_type: s.graduation_type,
      units_per_ml: String(s.units_per_ml),
      capacity_ml: s.capacity_ml,
      capacity_units: String(s.capacity_units),
      increment: s.increment,
    });
  const set = (key: keyof typeof blankForm, value: string) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setForm(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-1 h-3.5 w-3.5" />
          {t('medications.syringes.manage', 'Manage syringes')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('medications.syringes.title', 'Syringes')}
          </DialogTitle>
        </DialogHeader>
        {syringes.isError && (
          <p className="text-sm text-destructive">
            {t('medications.syringes.loadError', 'Could not load syringes.')}
          </p>
        )}
        <div className="space-y-2">
          {(syringes.data?.syringes ?? []).map((s) => (
            <div key={s.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                {s.id === syringes.data?.default_syringe_id && (
                  <Badge variant="secondary">
                    {t('medications.syringes.default', 'Default')}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  'medications.syringes.summary',
                  '{{capacity}} mL / {{units}} units · {{increment}} {{scale}} per mark',
                  {
                    capacity: s.capacity_ml,
                    units: s.capacity_units,
                    increment: s.increment,
                    scale:
                      s.graduation_type === 'ml'
                        ? 'mL'
                        : t('medications.syringes.units', 'units'),
                  }
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    makeDefault.mutate(
                      s.id === syringes.data?.default_syringe_id ? null : s.id
                    )
                  }
                >
                  {s.id === syringes.data?.default_syringe_id
                    ? t('medications.syringes.clearDefault', 'Clear default')
                    : t('medications.syringes.setDefault', 'Set default')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => edit(s)}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  {t('common.edit', 'Edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => remove.mutate(s.id)}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  {t('common.delete', 'Delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
        {form ? (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">
              {form.id
                ? t('medications.syringes.edit', 'Edit syringe')
                : t('medications.syringes.add', 'Add syringe')}
            </p>
            <div className="space-y-1">
              <Label htmlFor="syringe-name">
                {t('medications.syringes.name', 'Name')}
              </Label>
              <Input
                id="syringe-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="syringe-scale">
                {t('medications.syringes.graduation', 'Graduation scale')}
              </Label>
              <Select
                value={form.graduation_type}
                onValueChange={(value) => set('graduation_type', value)}
              >
                <SelectTrigger id="syringe-scale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="units">
                    {t('medications.syringes.unitGraduated', 'Units')}
                  </SelectItem>
                  <SelectItem value="ml">mL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  'units_per_ml',
                  'capacity_ml',
                  'capacity_units',
                  'increment',
                ] as const
              ).map((key) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`syringe-${key}`}>
                    {t(
                      `medications.syringes.${key}`,
                      {
                        units_per_ml: 'Units per mL',
                        capacity_ml: 'Capacity (mL)',
                        capacity_units: 'Capacity (units)',
                        increment: 'Smallest mark',
                      }[key]
                    )}
                  </Label>
                  <Input
                    id={`syringe-${key}`}
                    type="text"
                    inputMode="decimal"
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy || !input?.success}
                onClick={() => {
                  if (input?.success)
                    save.mutate(
                      { id: form.id, body: input.data },
                      { onSuccess: () => setForm(null) }
                    );
                }}
              >
                {t('common.save', 'Save')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setForm({ ...blankForm })}>
            <Plus className="mr-1 h-4 w-4" />
            {t('medications.syringes.add', 'Add syringe')}
          </Button>
        )}
        {(save.isError || remove.isError || makeDefault.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {t(
              'medications.syringes.changeError',
              'Could not update syringes.'
            )}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
