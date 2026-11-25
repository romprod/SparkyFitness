/**
 * Printable pre-visit checklist for a DEXA or RMR visit. The prep fields on the
 * scan form are answered from this plan, not from memory. Static content: no
 * data is read or written here. Ported from Pitstop's /body/prep.
 *
 * Reference only — not medical advice.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Group {
  key: string;
  title: string;
  sub: string;
  items: string[];
}

const GROUPS: Group[] = [
  {
    key: 'setup',
    title: 'Same setup as the last scan',
    sub: 'Anything that differs demotes the comparison.',
    items: [
      'Same machine — check the device serial on the report',
      'Same software version',
      'Same technologist, if the clinic can arrange it',
      'Same positioning protocol (ask the clinic to follow their last-visit notes)',
    ],
  },
  {
    key: 'before',
    title: 'The 48 hours before',
    sub: 'Presentation noise moves lean more than the scanner does.',
    items: [
      'Normal carbohydrate intake — no loading, no depletion',
      'Creatine unchanged — same dose as the previous month, or none both times',
      'Same secretagogue state as the last scan — same compounds, similar days since the last dose',
      'No illness in the 14 days before (fever, infection, gut illness)',
    ],
  },
  {
    key: 'morning',
    title: 'The morning of',
    sub: "Book the earliest slot; the scan is a snapshot of the body's water as much as its tissue.",
    items: [
      'Morning appointment',
      '12 h fasted — water only',
      'No caffeine',
      'No training in the previous 24 h',
      'No active travel to the clinic — no cycling or long walk',
      'Normal fluids the day before; bladder emptied just before the scan',
      'Remove metal: jewellery, belt, zips, underwired garments',
    ],
  },
  {
    key: 'rmr',
    title: 'RMR extras',
    sub: 'Only if a metabolic test is booked on the same visit.',
    items: [
      'Rest 20–30 minutes seated or lying before the mask goes on',
      'Awake and still during the test — no talking, reading or dozing',
      'Ask for the printed VO2 (mL/min) and the steady-state CV %',
      'Ask which equation and activity factor the clinic used for its predicted numbers',
    ],
  },
  {
    key: 'clinic',
    title: 'Ask the clinic',
    sub: 'Replaces every assumed noise band with a measured one.',
    items: [
      'A same-day repositioned duplicate scan (get off the table, get back on, scan again)',
      'A next-morning repeat under the same preparation',
      "The site's own precision figures (CV %) for fat, lean and BMD, if they have them",
    ],
  },
];

const CADENCE: string[] = [
  'DEXA every 12 weeks during a defined block (cut or surplus, chosen before it starts); every 6 months in maintenance; never under 6 weeks.',
  'Bone density is read on the 12-month scan.',
  'RMR: one duplicate retest within 1–2 weeks of the baseline (two consecutive mornings, same device), then 6-monthly or per block.',
];

const FIELDS: Array<{ key: string; label: string; blank: string }> = [
  { key: 'visitDate', label: 'Visit date:', blank: '____________' },
  { key: 'clinic', label: 'Clinic:', blank: '____________' },
  { key: 'fasted', label: 'Hours fasted at scan:', blank: '______' },
  {
    key: 'secretagogue',
    label: 'Days since last secretagogue dose:',
    blank: '______',
  },
];

const DISCLAIMER =
  'This view shows measurements and what was logged alongside them. Differences smaller than the noise band are not changes. Nothing here attributes a change to any compound, food, training or event. Not medical advice; discuss abnormal labs or scan results with a clinician.';

// Scoped to this page: the <style> is mounted only while the page is, and every
// content rule hangs off .dexa-checklist. The chrome rules hide the app layout's
// other children (header, tab bars, chat) next to the one holding this page.
const PRINT_CSS = `
@media print {
  html, body, .min-h-screen { background: #fff !important; }
  nav, header, footer { display: none !important; }
  .container:has(.dexa-checklist) > :not(:has(.dexa-checklist)) { display: none !important; }
  .container:has(.dexa-checklist) { max-width: none; padding: 0; }
  .dexa-checklist { max-width: none; padding: 0; margin: 0; }
  .dexa-checklist .no-print { display: none !important; }
  .dexa-checklist, .dexa-checklist * { background: #fff !important; color: #000 !important; box-shadow: none !important; }
  .dexa-checklist .prep-card { border: 1px solid #000 !important; break-inside: avoid; page-break-inside: avoid; margin-bottom: 12pt; }
  .dexa-checklist .prep-box { border: 1px solid #000 !important; }
  a[href]::after { content: none !important; }
}
`;

function Box() {
  return (
    <span
      className="prep-box mt-0.5 inline-block h-4 w-4 shrink-0 rounded-sm border border-foreground/40"
      aria-hidden="true"
    />
  );
}

export default function BodyCompPrepChecklist() {
  const { t } = useTranslation();
  return (
    <main className="dexa-checklist mx-auto max-w-5xl space-y-4">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/labs">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('labs.bodyComp.prep.back', 'Back to Labs')}
          </Link>
        </Button>
        <Button type="button" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" />
          {t('labs.bodyComp.prep.print', 'Print')}
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('labs.bodyComp.prep.title', 'Pre-visit checklist')}
        </h1>
        <p className="text-muted-foreground">
          {t(
            'labs.bodyComp.prep.intro',
            'Print this before a DEXA or RMR visit and tick it on the day. The entry form asks the same questions — answer them from this sheet, not from memory.'
          )}
        </p>
        <p className="no-print mt-2 text-xs text-muted-foreground">
          {t(
            'labs.bodyComp.prep.printHint',
            "Use your browser's print command (⌘P / Ctrl+P). Then enter the visit at"
          )}{' '}
          <Link
            to="/labs"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {t(
              'labs.bodyComp.prep.pointer',
              'Labs → Body composition (DEXA) → Add a scan'
            )}
          </Link>
          .
        </p>
      </div>

      <div className="prep-card rounded-lg border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {FIELDS.map((f) => (
            <p key={f.key} className="flex items-center gap-2">
              <span
                className="prep-box inline-block h-4 w-4 shrink-0 rounded-sm border border-foreground/40"
                aria-hidden="true"
              />
              {t(`labs.bodyComp.prep.fields.${f.key}`, f.label)}{' '}
              <span className="text-muted-foreground">{f.blank}</span>
            </p>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <section
            key={g.key}
            className="prep-card rounded-lg border bg-card p-4"
          >
            <h2 className="font-semibold">
              {t(`labs.bodyComp.prep.groups.${g.key}.title`, g.title)}
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {t(`labs.bodyComp.prep.groups.${g.key}.sub`, g.sub)}
            </p>
            <ul className="space-y-2">
              {g.items.map((item, i) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Box />
                  <span>
                    {t(`labs.bodyComp.prep.groups.${g.key}.item${i}`, item)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="prep-card rounded-lg border bg-card p-4">
        <h2 className="font-semibold">
          {t('labs.bodyComp.prep.cadence.title', 'Cadence')}
        </h2>
        <ul className="mt-2 space-y-1 text-sm">
          {CADENCE.map((line, i) => (
            <li key={line}>{t(`labs.bodyComp.prep.cadence.item${i}`, line)}</li>
          ))}
        </ul>
      </section>

      <p className="pt-2 text-xs text-muted-foreground">
        {t('labs.bodyComp.prep.disclaimer', DISCLAIMER)}
      </p>
    </main>
  );
}
