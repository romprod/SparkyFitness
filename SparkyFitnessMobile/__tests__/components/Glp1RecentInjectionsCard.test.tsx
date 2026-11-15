import { fireEvent, render } from '@testing-library/react-native';
import type { InjectionEntry } from '@workspace/shared';
import Glp1RecentInjectionsCard from '../../src/components/glp1/Glp1RecentInjectionsCard';
const row: InjectionEntry = {
  id: 'dose',
  medication_id: 'med',
  pen_id: 'vial',
  injected_at: '2026-11-15T12:34:56.789Z',
  entry_date: '2026-11-15',
  dose_mg: 1,
  site: 'stomach_upper_left',
  notes: null,
};
let mockRows: InjectionEntry[] = [];
jest.mock('../../src/hooks/useGlp1', () => ({
  useInjections: () => ({ data: mockRows }),
  useDeleteInjection: () => ({ mutate: jest.fn() }),
}));
jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: () => ({ preferences: { time_format: 'HH:mm' } }),
}));
jest.mock('../../src/components/Icon', () => ({
  __esModule: true,
  default: () => null,
}));
beforeEach(() => {
  mockRows = [];
});
test.each([
  { route: 'nasal', prefix: 'Nasal dose', site: false },
  { route: 'injection', prefix: 'Injection', site: true },
  { route: null, prefix: 'Recorded dose', site: true },
] as const)(
  'history uses only the saved route $route and opens the exact original record',
  ({ route, prefix, site }) => {
    mockRows = [{ ...row, administration_route: route }];
    const edit = jest.fn();
    const view = render(
      <Glp1RecentInjectionsCard medicationId="med" onEdit={edit} />
    );
    const label = view.getByText(new RegExp('^' + prefix)).props
      .children as string;
    expect(label.includes('Stomach')).toBe(site);
    fireEvent.press(view.getByLabelText('Edit'));
    expect(edit).toHaveBeenCalledWith(mockRows[0]);
  }
);
