import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  allocateMedicationPurchase,
  formatPurchaseMoney,
  medicationPurchaseInputSchema,
  PURCHASE_CONSUMABLE_CATEGORIES,
  todayInZone,
  type MedicationPurchaseInput,
  type MedicationPurchaseView,
  type MedicationPurchaseEditorData,
  type MedicationPurchaseCreateInput,
} from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useSaveMedicationPurchase } from '@/hooks/useMedicationPurchases';
import { HttpApiError } from '@/hooks/useMedicationPurchases';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Line = MedicationPurchaseInput['items'][number] & { key: string };
const notice =
  'whitespace-normal border-destructive bg-destructive/10 text-foreground hover:bg-destructive/10';
export default function MedicationPurchaseForm({
  ownerId,
  initial: initialValue,
  data,
  isCurrent,
  onDone,
  onCancel,
  onReload,
}: {
  ownerId: string;
  initial?: MedicationPurchaseView;
  data: MedicationPurchaseEditorData;
  isCurrent: () => boolean;
  onDone: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { timezone } = usePreferences();
  const [initial] = useState(initialValue);
  const [draftOwner] = useState(ownerId);
  const blankLine = (kind: 'medication' | 'consumable'): Line => ({
    key: crypto.randomUUID(),
    kind,
    medication_id:
      kind === 'medication' ? (data.medications[0]?.id ?? null) : null,
    category: kind === 'consumable' ? 'needle' : undefined,
    description: '',
    quantity: '1',
    unit_cost: '',
    units_per_pack: '',
    units_per_dose: '',
    vial_ids: [],
  });
  const [head, setHead] = useState({
    vendor: initial?.vendor ?? '',
    reference: initial?.reference ?? '',
    ordered_date: initial?.ordered_date ?? todayInZone(timezone),
    received_date: initial?.received_date ?? '',
    currency: initial?.currency ?? 'AUD',
    shipping_cost: initial?.shipping_cost ?? '',
    tax_cost: initial?.tax_cost ?? '',
    other_fees: initial?.other_fees ?? '',
    discount: initial?.discount ?? '',
    allocation_method: initial?.allocation_method ?? 'value',
    notes: initial?.notes ?? '',
  });
  const [lines, setLines] = useState<Line[]>(
    () =>
      initial?.items.map((line) => ({
        key: line.id,
        id: line.id,
        kind: line.kind,
        medication_id: line.medication_id,
        category: line.category ?? undefined,
        description: line.description,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        units_per_pack: line.units_per_pack,
        units_per_dose: line.units_per_dose,
        vial_ids: line.vial_ids,
      })) ?? [blankLine('medication')]
  );
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState<MedicationPurchaseCreateInput | null>(
    null
  );
  const save = useSaveMedicationPurchase();
  const locked = save.isPending || !!attempt;
  const change = () => {
    setAttempt(null);
    setError('');
  };
  const patchHead = (key: keyof typeof head, value: string) => {
    if (locked) return;
    change();
    setHead({ ...head, [key]: value });
  };
  const patchLine = (key: string, patch: Partial<Line>) => {
    if (locked) return;
    change();
    setLines(
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };
  const raw: MedicationPurchaseInput = {
    ...head,
    items: lines.map(({ key: _key, ...line }) => line),
  };
  const parsed = medicationPurchaseInputSchema.safeParse(raw);
  const allocation = parsed.success
    ? allocateMedicationPurchase({
        lines: parsed.data.items.map((line, i) => ({
          id: lines[i]!.key,
          quantity: line.quantity,
          unit_cost: line.unit_cost,
        })),
        ...parsed.data,
      })
    : null;
  const money = (value: string) =>
    formatPurchaseMoney(value, head.currency || 'AUD', i18n.language);
  const field = (key: keyof typeof head, label: string, type = 'text') => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={`purchase-${key}`}>{label}</Label>
      <Input
        id={`purchase-${key}`}
        type={type}
        inputMode={
          ['shipping_cost', 'tax_cost', 'other_fees', 'discount'].includes(key)
            ? 'decimal'
            : undefined
        }
        value={head[key]}
        onChange={(e) => patchHead(key, e.target.value)}
        disabled={locked}
      />
    </div>
  );
  const submit = async () => {
    if (!isCurrent() || draftOwner !== ownerId || save.isPending || stale)
      return;
    if (
      lines.some((line) =>
        line.kind === 'medication'
          ? !line.medication_id && !line.id
          : !line.description?.trim()
      )
    ) {
      setError(
        t(
          'medications.costs.lineRequired',
          'Choose a medication or enter a consumable description for each line.'
        )
      );
      return;
    }
    if (!parsed.success) {
      setError(
        t(
          'medications.costs.invalid',
          'Check the dates, quantities and nonnegative amounts.'
        )
      );
      return;
    }
    const body = initial
      ? {
          ...raw,
          expected_owner_id: draftOwner,
          expected_revision: initial.revision,
        }
      : (attempt ?? {
          ...raw,
          expected_owner_id: draftOwner,
          operation_id: crypto.randomUUID(),
        });
    if (!initial) setAttempt(body as MedicationPurchaseCreateInput);
    setError('');
    try {
      await save.mutateAsync({ id: initial?.id, body });
      if (isCurrent()) onDone();
    } catch (reason) {
      if (!isCurrent()) return;
      if (
        !initial &&
        !attempt &&
        reason instanceof HttpApiError &&
        [400, 409, 422].includes(reason.status)
      )
        setAttempt(null);
      if (reason instanceof HttpApiError && reason.status === 409 && initial)
        setStale(true);
      setError(
        reason instanceof Error
          ? reason.message
          : t('medications.costs.saveFailed', 'Could not save this invoice.')
      );
    }
  };
  return (
    <div className="min-w-0 space-y-4">
      <h2 className="text-xl font-semibold">
        {initial
          ? t('medications.costs.editInvoice', 'Edit invoice')
          : t('medications.costs.newInvoice', 'New invoice')}
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>{t('medications.costs.invoice', 'Invoice')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {field('vendor', t('medications.costs.supplier', 'Supplier'))}
          {field(
            'reference',
            t('medications.costs.reference', 'Invoice / order no.')
          )}
          {field(
            'ordered_date',
            t('medications.costs.ordered', 'Ordered'),
            'date'
          )}
          {field(
            'received_date',
            t('medications.costs.received', 'Received'),
            'date'
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            {t('medications.costs.shippingFees', 'Shipping & fees')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'medications.costs.shippingHint',
              'Enter shipping once. It is shared across every line on the order.'
            )}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {field(
              'shipping_cost',
              t('medications.costs.shipping', 'Shipping')
            )}
            {field('tax_cost', t('medications.costs.tax', 'Tax / GST'))}
            {field('other_fees', t('medications.costs.fees', 'Other fees'))}
            {field('discount', t('medications.costs.discount', 'Discount'))}
            {field('currency', t('medications.costs.currency', 'Currency'))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="purchase-allocation">
              {t('medications.costs.share', 'Share shipping & fees')}
            </Label>
            <select
              id="purchase-allocation"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={head.allocation_method}
              disabled={locked}
              onChange={(e) => patchHead('allocation_method', e.target.value)}
            >
              <option value="value">
                {t('medications.costs.byValue', 'Pro-rata by line value')}
              </option>
              <option value="quantity">
                {t('medications.costs.byQuantity', 'Equally per unit')}
              </option>
              <option value="none">
                {t('medications.costs.unallocated', 'Leave unallocated')}
              </option>
            </select>
          </div>
          {allocation?.effective_method === 'quantity-fallback' && (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.costs.fallback',
                'Every line has zero value, so shipping is split equally per unit instead.'
              )}
            </p>
          )}
          {allocation && allocation.unallocated !== '0.00' && (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.costs.unallocatedAmount',
                '{{amount}} stays unallocated.',
                { amount: money(allocation.unallocated) }
              )}
            </p>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {t('medications.costs.lines', 'Lines')}
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              change();
              setLines([...lines, blankLine('medication')]);
            }}
          >
            {t('medications.costs.addMedication', 'Add medication')}
          </Button>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              change();
              setLines([...lines, blankLine('consumable')]);
            }}
          >
            {t('medications.costs.addConsumable', 'Add consumable')}
          </Button>
        </div>
      </div>
      {lines.map((line, index) => {
        const preview = allocation?.lines.find((row) => row.id === line.key);
        const elsewhere = new Set(
          lines
            .filter((other) => other.key !== line.key)
            .flatMap((other) => other.vial_ids ?? [])
        );
        const candidates = data.vials.filter(
          (vial) =>
            vial.medication_id === line.medication_id && !elsewhere.has(vial.id)
        );
        const picked = line.vial_ids ?? [];
        const lineField = (
          key:
            | 'description'
            | 'quantity'
            | 'unit_cost'
            | 'units_per_pack'
            | 'units_per_dose',
          label: string
        ) => (
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${line.key}-${key}`}>{label}</Label>
            <Input
              id={`${line.key}-${key}`}
              value={line[key] ?? ''}
              inputMode={
                key === 'description'
                  ? undefined
                  : key === 'quantity' || key === 'units_per_pack'
                    ? 'numeric'
                    : 'decimal'
              }
              disabled={locked}
              onChange={(e) => patchLine(line.key, { [key]: e.target.value })}
            />
          </div>
        );
        return (
          <Card key={line.key}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">
                {t('medications.costs.lineNumber', 'Line {{number}}', {
                  number: index + 1,
                })}{' '}
                ·{' '}
                {line.kind === 'medication'
                  ? t('medications.costs.medication', 'Medication')
                  : t('medications.costs.consumable', 'Consumable')}
              </CardTitle>
              {lines.length > 1 && (
                <Button
                  variant="ghost"
                  disabled={locked}
                  aria-label={t(
                    'medications.costs.removeLine',
                    'Remove line {{number}}',
                    { number: index + 1 }
                  )}
                  onClick={() => {
                    change();
                    setLines(lines.filter((other) => other.key !== line.key));
                  }}
                >
                  ×
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${line.key}-kind`}>
                    {line.kind === 'medication'
                      ? t('medications.costs.medication', 'Medication')
                      : t('medications.costs.category', 'Category')}
                  </Label>
                  {line.kind === 'medication' ? (
                    <select
                      id={`${line.key}-kind`}
                      className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
                      value={line.medication_id ?? ''}
                      disabled={locked}
                      onChange={(e) =>
                        patchLine(line.key, {
                          medication_id: e.target.value || null,
                          vial_ids: [],
                        })
                      }
                    >
                      <option value="">
                        {line.id && !line.medication_id
                          ? t(
                              'medications.costs.removedMedication',
                              'Removed medication'
                            )
                          : t('medications.costs.choose', 'Choose…')}
                      </option>
                      {data.medications.map((med) => (
                        <option key={med.id} value={med.id}>
                          {med.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      id={`${line.key}-kind`}
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={line.category ?? 'other'}
                      disabled={locked}
                      onChange={(e) =>
                        patchLine(line.key, {
                          category: e.target.value as Line['category'],
                        })
                      }
                    >
                      {PURCHASE_CONSUMABLE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {t(
                            `medications.costs.categories.${category}`,
                            category.replaceAll('_', ' ')
                          )}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {lineField(
                  'description',
                  t('medications.costs.description', 'Description')
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {lineField(
                  'quantity',
                  line.kind === 'medication'
                    ? t('medications.costs.vials', 'Vials')
                    : t('medications.costs.packs', 'Packs')
                )}
                {lineField(
                  'unit_cost',
                  t('medications.costs.unitCost', 'Unit cost')
                )}
                {line.kind === 'consumable' && (
                  <>
                    {lineField(
                      'units_per_pack',
                      t('medications.costs.perPack', 'Per pack')
                    )}
                    {lineField(
                      'units_per_dose',
                      t('medications.costs.perDose', 'Used per dose')
                    )}
                  </>
                )}
              </div>
              {preview && (
                <dl className="grid grid-cols-1 gap-2 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">
                      {t('medications.costs.lineSubtotal', 'Line')}
                    </dt>
                    <dd className="break-words">{money(preview.subtotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t('medications.costs.shareAmount', 'Shipping share')}
                    </dt>
                    <dd className="break-words">{money(preview.allocated)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t('medications.costs.landedEach', 'Landed each')}
                    </dt>
                    <dd className="break-words font-medium">
                      {preview.landed_unit === null
                        ? '—'
                        : money(preview.landed_unit)}
                    </dd>
                  </div>
                </dl>
              )}
              {line.kind === 'medication' && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t(
                      'medications.costs.match',
                      'Match vials ({{matched}} of {{expected}})',
                      { matched: picked.length, expected: line.quantity }
                    )}
                  </p>
                  {!line.medication_id ? (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        'medications.costs.chooseFirst',
                        'Choose a medication to see its vials.'
                      )}
                    </p>
                  ) : candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        'medications.costs.noVials',
                        'No unmatched vials for this medication. Add them in Preparation & stock, then link them here.'
                      )}
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {candidates.map((vial) => (
                        <label
                          key={vial.id}
                          className="flex min-w-0 items-start gap-2 rounded-md border p-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={picked.includes(vial.id)}
                            disabled={locked}
                            onChange={(e) =>
                              patchLine(line.key, {
                                vial_ids: e.target.checked
                                  ? [...picked, vial.id]
                                  : picked.filter((id) => id !== vial.id),
                              })
                            }
                          />
                          <span className="min-w-0 break-words">
                            {vial.label || vial.medication_name}
                            {vial.label_mass_mg != null
                              ? ` · ${t('medications.labelMass.matching', 'Vial label amount: {{mass}} mg', { mass: vial.label_mass_mg })}`
                              : vial.prepared_mass_mg != null
                                ? ` · ${t('medications.costs.preparedContent', 'Prepared content: {{mass}} mg', { mass: vial.prepared_mass_mg })}`
                                : null}
                            {vial.lot_number &&
                              ` · ${t('medications.costs.lot', 'Lot')} ${vial.lot_number}`}{' '}
                            · {vial.status.replaceAll('_', ' ')}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {picked.length > Number(line.quantity) && (
                    <Badge variant="destructive" className={notice}>
                      {t(
                        'medications.costs.overmatched',
                        'More vials matched than this line bought. Raise the count or untick a vial.'
                      )}
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardContent className="space-y-3 pt-6">
          {allocation && (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              {(
                [
                  ['subtotal', t('medications.costs.lines', 'Lines')],
                  [
                    'overhead',
                    t('medications.costs.shippingFees', 'Shipping & fees'),
                  ],
                  ['total', t('medications.costs.total', 'Invoice total')],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words font-semibold">
                    {money(allocation[key])}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {field('notes', t('medications.costs.notes', 'Notes'))}
        </CardContent>
      </Card>
      {attempt && !save.isPending && error && (
        <p className="text-sm">
          {t(
            'medications.costs.uncertain',
            'The save result is unconfirmed. Retry this same invoice before editing it.'
          )}
        </p>
      )}
      {error && (
        <Badge variant="destructive" className={notice}>
          {error}
        </Badge>
      )}
      {stale && (
        <div className="space-y-2">
          <p className="text-sm">
            {t(
              'medications.costs.stale',
              'This invoice changed. Your draft is kept. Reload the saved invoice before editing again.'
            )}
          </p>
          <Button variant="outline" onClick={onReload}>
            {t('medications.costs.reload', 'Reload saved invoice')}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending || stale} onClick={submit}>
          {save.isPending
            ? t('common.saving', 'Saving…')
            : attempt
              ? t('medications.costs.retry', 'Retry save')
              : t('medications.costs.save', 'Save invoice')}
        </Button>
        <Button variant="outline" disabled={locked} onClick={onCancel}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
