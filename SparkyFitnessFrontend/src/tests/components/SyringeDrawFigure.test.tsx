import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SyringeDrawFigure from '@/pages/Medications/SyringeDrawFigure';

it('shows the authoritative pen marking in a dose window with a proportional cartridge strip', () => {
  render(
    <SyringeDrawFigure
      deviceType="pen"
      fillFraction={0.25}
      markingLabel="25 units"
      blocked={false}
    />
  );
  expect(
    screen.getByRole('img', { name: 'Pen dialled to 25 units' })
  ).toBeInTheDocument();
  expect(screen.getByText('Dial to 25 units')).toBeInTheDocument();
  expect(screen.getByTestId('pen-target-fill')).toHaveAttribute('width', '53');
  expect(screen.queryByTestId('syringe-target-fill')).not.toBeInTheDocument();
});
it('shows a pump bottle and count without drawing a syringe or capacity fill', () => {
  render(
    <SyringeDrawFigure
      deviceType="pump"
      fillFraction={0.5}
      markingLabel="2 pumps (0.2 mL)"
      blocked={false}
    />
  );
  expect(
    screen.getByRole('img', { name: 'Nasal pump: 2 pumps (0.2 mL)' })
  ).toBeInTheDocument();
  expect(screen.getByTestId('pump-graphic')).toBeInTheDocument();
  expect(screen.getByText('Spray 2 pumps (0.2 mL)')).toBeInTheDocument();
  expect(screen.queryByTestId('syringe-target-fill')).not.toBeInTheDocument();
  expect(screen.queryByTestId('pen-target-fill')).not.toBeInTheDocument();
});
it.each(['syringe', 'pen', 'pump'] as const)(
  'keeps a neutral %s visible without manufacturing a numeric marking',
  (deviceType) => {
    render(
      <SyringeDrawFigure
        deviceType={deviceType}
        fillFraction={0}
        markingLabel="—"
        blocked={false}
      />
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      expect.stringContaining('—')
    );
    expect(screen.queryByText(/units|pumps|mL/)).not.toBeInTheDocument();
  }
);
it('clamps invalid fill data and retains block emphasis', () => {
  const { rerender } = render(
    <SyringeDrawFigure
      deviceType="pen"
      fillFraction={Infinity}
      markingLabel="—"
      blocked={false}
    />
  );
  expect(screen.getByTestId('pen-target-fill')).toHaveAttribute('width', '0');
  rerender(
    <SyringeDrawFigure
      deviceType="pen"
      fillFraction={2}
      markingLabel="200 units"
      blocked
    />
  );
  expect(screen.getByTestId('pen-target-fill')).toHaveAttribute('width', '212');
  expect(screen.getByText('Dial to 200 units')).toHaveClass('bg-destructive');
});
