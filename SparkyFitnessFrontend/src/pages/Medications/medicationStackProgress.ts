import type { MedicationStackMember } from '@workspace/shared';

/** Where one stack member stands for the selected day. */
export type StackMemberState =
  /** Every dose due today is logged or skipped. */
  | 'logged'
  /** Due and can be logged straight from the stack. */
  | 'ready'
  /** Due, but needs its own log (a site, a vial or a course confirmation). */
  | 'own-log'
  /** Nothing scheduled today. */
  | 'not-due';

export interface StackMemberProgress {
  member: MedicationStackMember;
  state: StackMemberState;
}

export interface StackProgress<D> {
  members: StackMemberProgress[];
  /** Unlogged doses the stack can log in one go. */
  loggable: D[];
  /** Members with a dose that must be logged from its own row. */
  needsOwnLog: MedicationStackMember[];
  due: number;
  logged: number;
}

/**
 * Pure: how a stack's members stand today. A dose is "simple" when the stack
 * may log it without asking anything (not an injectable that needs a site and
 * vial, not a managed course dose that needs confirmation).
 */
export function stackProgress<D extends { medication: { id: string } }>(
  members: MedicationStackMember[],
  dues: readonly D[],
  isLogged: (due: D) => boolean,
  isSimple: (due: D) => boolean
): StackProgress<D> {
  const progress: StackMemberProgress[] = [];
  const loggable: D[] = [];
  const needsOwnLog: MedicationStackMember[] = [];
  let due = 0;
  let logged = 0;
  for (const member of members) {
    const mine = dues.filter(
      (item) => item.medication.id === member.medication_id
    );
    if (mine.length === 0) {
      progress.push({ member, state: 'not-due' });
      continue;
    }
    due += mine.length;
    const open = mine.filter((item) => !isLogged(item));
    logged += mine.length - open.length;
    if (open.length === 0) {
      progress.push({ member, state: 'logged' });
      continue;
    }
    const simple = open.filter(isSimple);
    loggable.push(...simple);
    if (simple.length < open.length) {
      needsOwnLog.push(member);
      progress.push({ member, state: 'own-log' });
    } else progress.push({ member, state: 'ready' });
  }
  return { members: progress, loggable, needsOwnLog, due, logged };
}
