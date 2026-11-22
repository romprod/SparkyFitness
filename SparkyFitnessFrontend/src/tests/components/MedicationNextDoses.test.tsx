import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationNextDoses from '@/pages/Medications/MedicationNextDoses';
import type { Medication } from '@/types/medications';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    timezone: 'Europe/London',
    formatDate: (day: string) => `UK:${day}`,
  }),
}));
type Slot = Record<string, unknown>;
let mockWeeks: Record<string, Slot[]> = {};
const mockWeek = jest.fn((weekStart: string, enabled: boolean) => ({
  data:
    enabled && mockWeeks[weekStart]
      ? { week_start: weekStart, planned_slots: mockWeeks[weekStart] }
      : undefined,
}));
jest.mock('@/hooks/Medications/useMedicationLogWeek', () => ({
  useMedicationLogWeek: (weekStart: string, enabled: boolean) =>
    mockWeek(weekStart, enabled),
}));

const med = (id: string, name: string, patch: Partial<Medication> = {}) =>
  ({
    id,
    name,
    display_name: null,
    type_id: 'injection',
    is_active: true,
    is_supplement: false,
    ...patch,
  }) as unknown as Medication;
const reta = med('reta', 'Retatrutide');
const cagri = med('cagri', 'Cagrilintide');
const slot = (patch: Slot = {}): Slot => ({
  id: 'slot',
  medication_id: 'reta',
  scheduled_day: '2026-11-22',
  scheduled_for: '2026-11-22T13:00:00.000Z',
  time_of_day: '13:00:00',
  status: 'planned',
  dose_amount: '2',
  dose_unit: 'mg',
  ...patch,
});
const cagriSlot = slot({
  id: 'cagri-slot',
  medication_id: 'cagri',
  scheduled_day: '2026-11-26',
  scheduled_for: '2026-11-26T19:00:00.000Z',
  time_of_day: '19:00:00',
  dose_amount: '0.2500',
  dose_unit: 'mg',
});
const renderCard = (medications: Medication[]) =>
  render(<MedicationNextDoses medications={medications} today="2026-11-22" />);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-22T10:00:00.000Z'));
  mockWeeks = {};
  mockWeek.mockClear();
});
afterEach(() => jest.useRealTimers());

it('lists each injectable’s next dose, soonest first, counting down only a dose later today', () => {
  mockWeeks = {
    '2026-11-16': [slot()],
    '2026-11-23': [cagriSlot],
  };
  renderCard([cagri, reta]);
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('Retatrutide · 2 mg');
  expect(items[0]).toHaveTextContent('Today 13:00 · in 3h 0m');
  expect(items[1]).toHaveTextContent('Cagrilintide · 0.25 mg');
  expect(items[1]).toHaveTextContent('Thursday 19:00');
  expect(screen.getByText(/Next injection/)).toBeInTheDocument();
});

it('leaves out supplements, other forms and stopped medications', () => {
  mockWeeks = {
    '2026-11-16': [
      slot(),
      slot({ id: 'pill', medication_id: 'pill' }),
      slot({ id: 'supp', medication_id: 'supp' }),
      slot({ id: 'off', medication_id: 'off' }),
    ],
  };
  renderCard([
    reta,
    med('pill', 'Sertraline', { type_id: 'pill' }),
    med('supp', 'Peptide supplement', { is_supplement: true }),
    med('off', 'Old injection', { is_active: false }),
  ]);
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('Next injection')).toBeInTheDocument();
  expect(
    screen.queryByText(/Sertraline|Old injection/)
  ).not.toBeInTheDocument();
});

it('ignores doses already taken, skipped or past', () => {
  mockWeeks = {
    '2026-11-16': [
      slot({ id: 'taken', status: 'taken' }),
      slot({ id: 'past', scheduled_for: '2026-11-22T09:00:00.000Z' }),
    ],
  };
  const { container } = renderCard([reta]);
  expect(container).toBeEmptyDOMElement();
});

it('reads another week only while an injectable has nothing planned yet', () => {
  mockWeeks = { '2026-11-16': [slot()] };
  renderCard([reta]);
  // Found in the first week, so no later week is requested.
  expect(mockWeek).toHaveBeenCalledWith('2026-11-16', true);
  expect(mockWeek).toHaveBeenCalledWith('2026-11-23', false);
  expect(mockWeek).not.toHaveBeenCalledWith('2026-11-23', true);
});

it('keeps reading weeks until the dose is found', () => {
  mockWeeks = {
    '2026-11-16': [],
    '2026-11-23': [],
    '2026-11-30': [
      slot({
        scheduled_day: '2026-12-04',
        scheduled_for: '2026-12-04T13:00:00.000Z',
      }),
    ],
  };
  renderCard([reta]);
  expect(mockWeek).toHaveBeenCalledWith('2026-11-30', true);
  expect(mockWeek).toHaveBeenCalledWith('2026-12-07', false);
  // Twelve days out names the date in the person’s own format, not the weekday.
  expect(screen.getByRole('listitem')).toHaveTextContent('UK:2026-12-04 13:00');
});

it('shows nothing and reads nothing when there is no injectable', () => {
  const { container } = renderCard([
    med('pill', 'Sertraline', { type_id: 'pill' }),
  ]);
  expect(container).toBeEmptyDOMElement();
  expect(mockWeek).not.toHaveBeenCalledWith(expect.anything(), true);
});
