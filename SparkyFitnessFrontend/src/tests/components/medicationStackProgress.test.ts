import { stackProgress } from '@/pages/Medications/medicationStackProgress';

const member = (id: string, name = id) => ({
  medication_id: id,
  name,
  is_supplement: false,
  is_active: true,
});
const due = (id: string, key: string, extra: object = {}) => ({
  key,
  medication: { id },
  ...extra,
});
const isLogged = (d: { key: string }) => d.key.startsWith('done');
const isSimple = (d: object) => !('hard' in d);

it('splits members into logged, ready, own-log and not due', () => {
  const dues = [
    due('a', 'done-1'),
    due('b', 'b-1'),
    due('b', 'b-2'),
    due('c', 'c-1', { hard: true }),
  ];
  const result = stackProgress(
    [member('a'), member('b'), member('c'), member('d')],
    dues,
    isLogged,
    isSimple
  );
  expect(result.members.map((m) => m.state)).toEqual([
    'logged',
    'ready',
    'own-log',
    'not-due',
  ]);
  expect(result.loggable.map((d) => d.key)).toEqual(['b-1', 'b-2']);
  expect(result.needsOwnLog.map((m) => m.medication_id)).toEqual(['c']);
  expect(result.due).toBe(4);
  expect(result.logged).toBe(1);
});

it('keeps a partly simple member loggable for its simple doses and flags the rest', () => {
  const result = stackProgress(
    [member('a')],
    [due('a', 'a-1'), due('a', 'a-2', { hard: true })],
    isLogged,
    isSimple
  );
  expect(result.loggable.map((d) => d.key)).toEqual(['a-1']);
  expect(result.members[0]?.state).toBe('own-log');
});

it('has nothing to log for an empty day', () => {
  const result = stackProgress([member('a')], [], isLogged, isSimple);
  expect(result).toMatchObject({
    loggable: [],
    needsOwnLog: [],
    due: 0,
    logged: 0,
  });
});
