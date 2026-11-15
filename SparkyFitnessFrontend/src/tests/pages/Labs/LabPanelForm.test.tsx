import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { buildManualLabPanel, type LabPanelDraft } from '@workspace/shared';
import LabPanelForm from '@/pages/Labs/LabPanelForm';
import { useCreateManualLabPanel } from '@/hooks/Labs/useLabResults';
jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'UTC' }),
}));
jest.mock('@/hooks/Labs/useLabResults', () => ({
  useCreateManualLabPanel: jest.fn(),
}));
const mutateAsync = jest.fn();
const onSaved = jest.fn();
const show = () =>
  render(
    <LabPanelForm
      ownerId="00000000-0000-4000-8000-000000000001"
      customMarkers={[]}
      labels={{ hba1c: 'HbA1c', ldl: 'LDL' }}
      onSaved={onSaved}
    />
  );
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(useCreateManualLabPanel)
    .mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<
      typeof useCreateManualLabPanel
    >);
  mutateAsync.mockResolvedValue({});
});
it('saves two raw results as one manual panel with their own units and ranges', async () => {
  show();
  fireEvent.change(screen.getByLabelText('Lab / source'), {
    target: { value: 'Example lab' },
  });
  fireEvent.change(screen.getByLabelText('Result', { exact: true }), {
    target: { value: '≤3' },
  });
  fireEvent.change(screen.getByLabelText('High', { exact: true }), {
    target: { value: '4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add result' }));
  fireEvent.change(screen.getAllByLabelText('Marker')[1]!, {
    target: { value: 'builtin:ldl' },
  });
  fireEvent.change(screen.getAllByLabelText('Result', { exact: true })[1]!, {
    target: { value: 'Negative' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save lab panel' }));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  expect(mutateAsync.mock.calls[0]![0]).toMatchObject({
    expected_owner_id: '00000000-0000-4000-8000-000000000001',
    lab_name: 'Example lab',
    results: [
      {
        marker_key: 'hba1c',
        value_text: '≤3',
        unit: '%',
        ref_range_low: null,
        ref_range_high: 4,
      },
      {
        marker_key: 'ldl',
        value_text: 'Negative',
        ref_range_low: null,
        ref_range_high: null,
      },
    ],
  });
  expect(mutateAsync.mock.calls[0]![0].results[0]).not.toHaveProperty(
    'value_numeric'
  );
  expect(onSaved).toHaveBeenCalledTimes(1);
});
it('keeps the draft owner bound and ignores a completion after its scope is removed', async () => {
  let current = true;
  let finish: (value: unknown) => void = () => undefined;
  mutateAsync.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const props = {
    customMarkers: [],
    labels: {},
    onSaved,
    isScopeCurrent: () => current,
  };
  const view = render(
    <LabPanelForm {...props} ownerId="00000000-0000-4000-8000-000000000001" />
  );
  fireEvent.change(screen.getByLabelText('Result', { exact: true }), {
    target: { value: '<3' },
  });
  view.rerender(
    <LabPanelForm {...props} ownerId="00000000-0000-4000-8000-000000000002" />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save lab panel' }));
  expect(mutateAsync.mock.calls[0]![0].expected_owner_id).toBe(
    '00000000-0000-4000-8000-000000000001'
  );
  current = false;
  finish({});
  await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Save lab panel' }));
  expect(mutateAsync).toHaveBeenCalledTimes(1);
});
it('keeps entered raw values on a failed save and exposes a retry', async () => {
  mutateAsync.mockRejectedValue(new Error('Synthetic failure'));
  show();
  fireEvent.change(screen.getByLabelText('Result', { exact: true }), {
    target: { value: '>3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save lab panel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your entries are kept'
  );
  expect(screen.getByLabelText('Result', { exact: true })).toHaveValue('>3');
  expect(onSaved).not.toHaveBeenCalled();
});
it('removes a row without changing the remaining row', () => {
  show();
  fireEvent.change(screen.getByLabelText('Result', { exact: true }), {
    target: { value: '<3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add result' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove result 2' }));
  expect(screen.getAllByLabelText('Result', { exact: true })).toHaveLength(1);
  expect(screen.getByLabelText('Result', { exact: true })).toHaveValue('<3');
});
const draft = (): LabPanelDraft => ({
  date: '2026-01-01',
  labName: '',
  notes: '',
  rows: [
    {
      key: 'a',
      marker: 'builtin:hba1c',
      value: '5,1',
      unit: '%',
      low: '',
      high: '',
    },
  ],
});
it('shared web/native draft rules keep raw values, ignore unused rows, reject duplicate markers and invalid ranges', () => {
  const source = draft();
  source.rows.push({ ...source.rows[0]!, key: 'blank', value: '' });
  const built = buildManualLabPanel(source, '2026-01-02');
  expect(built.ok && built.body.results).toHaveLength(1);
  expect(built.ok && built.body.results[0]?.value_text).toBe('5,1');
  source.rows[1]!.value = '<3';
  expect(buildManualLabPanel(source, '2026-01-02')).toEqual({
    ok: false,
    error: 'duplicate',
  });
  const range = draft();
  range.rows[0]!.low = '9';
  range.rows[0]!.high = '4';
  expect(buildManualLabPanel(range, '2026-01-02')).toEqual({
    ok: false,
    error: 'range',
  });
  expect(
    buildManualLabPanel({ ...draft(), date: '2026-02-31' }, '2026-03-01')
  ).toEqual({ ok: false, error: 'date' });
});
