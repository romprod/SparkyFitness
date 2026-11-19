import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  medicationStackInputSchema,
  MAX_STACK_MEMBERS,
  type MedicationStack,
} from '@workspace/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMedications } from '@/hooks/useMedications';
import { useSaveStackMutation } from '@/hooks/Medications/useMedicationStacks';

/** Create a stack, or edit one: a name, optional notes and the items in it. */
export default function MedicationStackDialog({
  stack,
  onClose,
}: {
  /** The stack to edit; omit to create a new one. */
  stack?: MedicationStack;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const medsQuery = useMedications({ activeOnly: true });
  const save = useSaveStackMutation();
  const [name, setName] = useState(stack?.name ?? '');
  const [notes, setNotes] = useState(stack?.notes ?? '');
  const [selected, setSelected] = useState<string[]>(
    stack?.members.map((member) => member.medication_id) ?? []
  );
  const [error, setError] = useState<string | null>(null);

  const available = (medsQuery.data ?? []).map((med) => ({
    id: med.id,
    name: med.display_name || med.name,
    supplement: Boolean(med.is_supplement),
  }));
  // Members that are no longer active stay selectable so editing never drops them silently.
  const inactive = (stack?.members ?? []).filter(
    (member) => !available.some((item) => item.id === member.medication_id)
  );
  const groups = [
    {
      key: 'medications',
      label: t('medications.stacks.medications', 'Medications'),
      items: available.filter((item) => !item.supplement),
    },
    {
      key: 'supplements',
      label: t('medications.stacks.supplements', 'Supplements'),
      items: available.filter((item) => item.supplement),
    },
  ].filter((group) => group.items.length > 0);

  const toggle = (id: string, on: boolean) => {
    setSelected((rows) =>
      on ? [...rows, id] : rows.filter((row) => row !== id)
    );
    setError(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = medicationStackInputSchema.safeParse({
      name,
      notes,
      medication_ids: selected,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          t('medications.stacks.invalid', 'Check the stack and try again.')
      );
      return;
    }
    save.mutate(
      { id: stack?.id, body: parsed.data },
      {
        onSuccess: onClose,
        onError: (failure) =>
          setError(
            (failure as { status?: number }).status === 409
              ? t(
                  'medications.stacks.duplicate',
                  'You already have a stack with that name.'
                )
              : t(
                  'medications.stacks.saveFailed',
                  'Could not save the stack. Please try again.'
                )
          ),
      }
    );
  };

  const row = (id: string, label: string, note?: string) => (
    <div key={id} className="flex items-start gap-2">
      <Checkbox
        id={`stack-item-${id}`}
        checked={selected.includes(id)}
        onCheckedChange={(value) => toggle(id, value === true)}
        disabled={
          !selected.includes(id) && selected.length >= MAX_STACK_MEMBERS
        }
      />
      <Label htmlFor={`stack-item-${id}`} className="font-normal">
        {label}
        {note && (
          <span className="ml-1 text-xs text-muted-foreground">{note}</span>
        )}
      </Label>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {stack
              ? t('medications.stacks.editTitle', 'Edit stack')
              : t('medications.stacks.newTitle', 'New stack')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.stacks.help',
              'A stack groups things you take together. Each item keeps its own schedule and dose; the stack only lets you log what is due in one tap.'
            )}
          </p>
          <div className="space-y-2">
            <Label htmlFor="stack-name">
              {t('medications.stacks.name', 'Name')}
            </Label>
            <Input
              id="stack-name"
              value={name}
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              {t('medications.stacks.items', 'Items in this stack')}
            </legend>
            {medsQuery.isLoading && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('common.loading', 'Loading…')}
              </p>
            )}
            {groups.map((group) => (
              <div key={group.key} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item) => row(item.id, item.name))}
              </div>
            ))}
            {inactive.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('medications.stacks.inactive', 'No longer active')}
                </p>
                {inactive.map((member) =>
                  row(member.medication_id, member.name)
                )}
              </div>
            )}
            {!medsQuery.isLoading && groups.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t(
                  'medications.stacks.noItems',
                  'Add a medication or supplement first.'
                )}
              </p>
            )}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="stack-notes">{t('common.notes', 'Notes')}</Label>
            <Input
              id="stack-notes"
              value={notes}
              maxLength={1000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? t('common.saving', 'Saving…')
                : t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
