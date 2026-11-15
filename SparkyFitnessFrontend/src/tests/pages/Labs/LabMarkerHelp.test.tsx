import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LabMarkerHelp from '@/pages/Labs/LabMarkerHelp';
import { LAB_MARKER_DESCRIPTIONS } from '@/pages/Labs/labMarkerDescriptions';
import { LAB_MARKER_PRESETS } from '@workspace/shared';
import english from '../../../../public/locales/en/translation.json';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

it('explains the explicit built-in marker on keyboard focus and dismisses with Escape', async () => {
  render(<LabMarkerHelp name="HbA1c" markerKey="hba1c" />);
  const trigger = screen.getByRole('button', { name: 'About HbA1c' });
  fireEvent.focus(trigger);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'average blood glucose'
  );
  fireEvent.keyDown(trigger, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  );
});

it('opens on mouse hover without needing a click', async () => {
  render(<LabMarkerHelp name="HbA1c" markerKey="hba1c" />);
  fireEvent.pointerMove(screen.getByRole('button', { name: 'About HbA1c' }), {
    pointerType: 'mouse',
  });
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'average blood glucose'
  );
});

it('opens and closes by tap without triggering a surrounding selection handler', async () => {
  const select = jest.fn();
  render(
    <div onClick={select}>
      <LabMarkerHelp name="HbA1c" markerKey="hba1c" />
    </div>
  );
  const trigger = screen.getByRole('button', { name: 'About HbA1c' });
  fireEvent.pointerDown(trigger, { pointerType: 'touch' });
  fireEvent.click(trigger);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('haemoglobin');
  expect(select).not.toHaveBeenCalled();
  fireEvent.pointerDown(trigger, { pointerType: 'touch' });
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  );
});

it.each([null, 'new-unknown-test', '__proto__', 'constructor'])(
  'never infers a medical meaning from a custom name (%s)',
  async (markerKey) => {
    render(<LabMarkerHelp name="HbA1c" markerKey={markerKey} />);
    fireEvent.click(screen.getByRole('button', { name: 'About HbA1c' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'No verified explanation'
    );
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'average blood glucose'
    );
  }
);

it('keeps sourced definitions tied to catalogue identities', () => {
  const keys = LAB_MARKER_PRESETS.map((marker) => marker.key);
  const known = new Set(keys);
  expect(Object.keys(LAB_MARKER_DESCRIPTIONS).sort()).toEqual([...keys].sort());
  expect(Object.keys(english.labs.markerHelp.descriptions).sort()).toEqual(
    [...keys].sort()
  );
  for (const [key, entry] of Object.entries(LAB_MARKER_DESCRIPTIONS)) {
    expect(known.has(key)).toBe(true);
    expect(entry.description.length).toBeGreaterThan(35);
    expect(
      english.labs.markerHelp.descriptions[
        key as keyof typeof english.labs.markerHelp.descriptions
      ]
    ).toBe(entry.description);
    expect(entry.sources.length).toBeGreaterThan(0);
    for (const source of entry.sources) expect(source).toMatch(/^https:\/\//);
  }
});
