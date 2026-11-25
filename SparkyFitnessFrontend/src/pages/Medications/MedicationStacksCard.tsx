import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CircleDashed,
  Droplet,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { MedicationStack } from '@workspace/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useMedicationStacks } from '@/hooks/Medications/useMedicationStacks';
import { useDeleteStackMutation } from '@/hooks/Medications/useMedicationStacks';
import MedicationStackDialog from './MedicationStackDialog';
import MedicationStackSetupDialog from './MedicationStackSetupDialog';
import {
  stackProgress,
  type StackMemberState,
} from './medicationStackProgress';

export interface StackLogResult {
  logged: number;
  failed: string[];
}

/**
 * Stacks on the Log tab: each shows what is due today, with one button that
 * logs every dose it can without asking. Doses that need a site, a vial or a
 * course confirmation are listed so they get logged from their own row.
 */
export default function MedicationStacksCard<
  D extends { medication: { id: string } },
>({
  dues,
  isLogged,
  isSimple,
  canWrite,
  logDues,
}: {
  dues: readonly D[];
  isLogged: (due: D) => boolean;
  isSimple: (due: D) => boolean;
  canWrite: boolean;
  logDues: (dues: D[]) => Promise<StackLogResult>;
}) {
  const { t } = useTranslation();
  const stacks = useMedicationStacks();
  const remove = useDeleteStackMutation();
  const [editing, setEditing] = useState<MedicationStack | 'new' | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});

  if (!stacks.scope.ready || !stacks.scope.isCurrent()) return null;
  const list = stacks.data?.stacks ?? [];
  // Nothing to show until a stack exists; creating one stays one click away.
  if (list.length === 0 && !canWrite) return null;

  const stateLabel: Record<StackMemberState, string> = {
    logged: t('medications.stacks.state.logged', 'Logged'),
    ready: t('medications.stacks.state.ready', 'Due'),
    'own-log': t('medications.stacks.state.ownLog', 'Log separately'),
    'not-due': t('medications.stacks.state.notDue', 'Not due today'),
  };

  const log = async (stack: MedicationStack, loggable: D[]) => {
    setBusy(stack.id);
    setNotices((old) => ({ ...old, [stack.id]: '' }));
    try {
      const result = await logDues(loggable);
      const parts = [
        t('medications.stacks.loggedCount', {
          defaultValue_one: 'Logged {{count}} dose.',
          defaultValue_other: 'Logged {{count}} doses.',
          count: result.logged,
        }),
      ];
      if (result.failed.length)
        parts.push(
          t('medications.stacks.failed', {
            defaultValue: 'Could not log: {{names}}.',
            names: result.failed.join(', '),
          })
        );
      setNotices((old) => ({ ...old, [stack.id]: parts.join(' ') }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base font-semibold">
            <span className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/50">
                <Layers className="h-3.5 w-3.5 text-violet-500" />
              </span>
              {t('medications.stacks.title', 'Stacks')}
            </span>
            {canWrite && (
              <span className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSettingUp(true)}
                >
                  <Droplet className="mr-1 h-4 w-4" />
                  {t(
                    'medications.stacks.setup.button',
                    'Set up a premixed stack'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing('new')}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  {t('medications.stacks.new', 'New stack')}
                </Button>
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {t(
              'medications.stacks.description',
              'Groups you take together. Log everything due in one tap.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stacks.query.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('medications.stacks.loadFailed', 'Could not load stacks.')}
            </p>
          )}
          {!stacks.query.isError && list.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t(
                'medications.stacks.empty',
                'No stacks yet. Create one for things you take together, like a morning routine.'
              )}
            </p>
          )}
          {list.map((stack) => {
            const progress = stackProgress(
              stack.members,
              dues,
              isLogged,
              isSimple
            );
            const skipped = progress.needsOwnLog.map((member) => member.name);
            return (
              <section
                key={stack.id}
                aria-label={stack.name}
                className="space-y-3 rounded-lg border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words font-medium">{stack.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {progress.due === 0
                        ? t(
                            'medications.stacks.nothingDue',
                            'Nothing due today'
                          )
                        : t('medications.stacks.progress', {
                            defaultValue: '{{logged}} of {{due}} logged today',
                            logged: progress.logged,
                            due: progress.due,
                          })}
                    </p>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t(
                          'medications.stacks.editNamed',
                          'Edit {{name}}',
                          { name: stack.name }
                        )}
                        onClick={() => setEditing(stack)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t(
                          'medications.stacks.deleteNamed',
                          'Delete {{name}}',
                          { name: stack.name }
                        )}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                'medications.stacks.confirmDelete',
                                'Delete this stack? The medications and supplements in it, and their history, are kept.'
                              )
                            )
                          )
                            remove.mutate(stack.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="space-y-1 text-sm">
                  {progress.members.map(({ member, state }) => (
                    <li
                      key={member.medication_id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span
                        className={
                          state === 'not-due'
                            ? 'break-words text-muted-foreground'
                            : 'break-words'
                        }
                      >
                        {member.name}
                        {!member.is_active && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {t('medications.stacks.inactiveTag', '(inactive)')}
                          </span>
                        )}
                      </span>
                      <span
                        className={`flex shrink-0 items-center gap-1 text-xs ${
                          state === 'logged'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : state === 'own-log'
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {state === 'logged' ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <CircleDashed
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        )}
                        {stateLabel[state]}
                      </span>
                    </li>
                  ))}
                </ul>
                {canWrite && (
                  <Button
                    size="sm"
                    disabled={busy !== null || progress.loggable.length === 0}
                    onClick={() => void log(stack, progress.loggable)}
                  >
                    <Check className="mr-1 h-4 w-4" />
                    {progress.loggable.length === 0
                      ? t('medications.stacks.logNone', 'Nothing to log')
                      : t('medications.stacks.logStack', {
                          defaultValue_one: 'Log stack ({{count}} dose)',
                          defaultValue_other: 'Log stack ({{count}} doses)',
                          count: progress.loggable.length,
                        })}
                  </Button>
                )}
                {skipped.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('medications.stacks.separately', {
                      defaultValue:
                        'Log separately from its own row: {{names}}.',
                      names: skipped.join(', '),
                    })}
                  </p>
                )}
                {notices[stack.id] && (
                  <p role="status" className="text-sm">
                    {notices[stack.id]}
                  </p>
                )}
              </section>
            );
          })}
        </CardContent>
      </Card>
      {settingUp && (
        <MedicationStackSetupDialog onClose={() => setSettingUp(false)} />
      )}
      {editing && (
        <MedicationStackDialog
          stack={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
