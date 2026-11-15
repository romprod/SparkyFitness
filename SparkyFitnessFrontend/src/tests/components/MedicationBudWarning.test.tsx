import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MedicationBudWarning from '@/pages/Medications/MedicationBudWarning';
let mockTimezone = 'Asia/Tokyo';
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: mockTimezone }),
}));
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-15T23:30:00Z'));
  mockTimezone = 'Asia/Tokyo';
});
afterEach(() => jest.useRealTimers());
it('warns from the viewer local calendar day including the BUD day', () => {
  render(<MedicationBudWarning date="2026-11-16" />);
  expect(
    screen.getByText('Beyond-use date 2026-11-16 — 0 days left.')
  ).toBeInTheDocument();
});
it('warns for the source three-day window and does not add a stability default', () => {
  const { rerender } = render(<MedicationBudWarning date="2026-11-19" />);
  expect(screen.getByText(/3 days left/)).toBeInTheDocument();
  rerender(<MedicationBudWarning date="2026-11-20" />);
  expect(screen.queryByText(/days left/)).not.toBeInTheDocument();
  rerender(<MedicationBudWarning />);
  expect(screen.queryByText(/Beyond-use/)).not.toBeInTheDocument();
});
it('marks the following local day as past without changing a saved date', () => {
  render(<MedicationBudWarning date="2026-11-15" />);
  expect(
    screen.getByText('Past beyond-use date (2026-11-15).')
  ).toBeInTheDocument();
});
