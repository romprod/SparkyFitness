import { render } from '@testing-library/react-native';
import PreparationBudNotice from '../../src/components/glp1/PreparationBudNotice';
jest.mock('../../src/utils/dateUtils', () => ({
  getTodayDate: () => '2026-11-15',
}));
test.each([null, undefined, '2026-11-19'])(
  'does not invent an imminent beyond-use notice for %s',
  (date) => {
    const view = render(<PreparationBudNotice date={date} />);
    expect(view.toJSON()).toBeNull();
  }
);
test.each(['2026-11-15', '2026-11-18'])(
  'uses today-local through three days inclusive for %s',
  (date) => {
    const view = render(<PreparationBudNotice date={date} />);
    expect(
      view.getByText('The recorded beyond-use date is within three days.')
    ).toBeTruthy();
  }
);
test('past explicit dates warn without a clinical or blocking action', () => {
  const view = render(<PreparationBudNotice date="2026-11-14" />);
  expect(
    view.getByText('This preparation is past its recorded beyond-use date.')
  ).toBeTruthy();
  expect(view.queryAllByRole('button')).toHaveLength(0);
});
