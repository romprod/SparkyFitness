import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  computeDraw,
  type DrawResult,
  type MedicationSyringeInput,
} from '@workspace/shared';
import MedicationDrawPreview from '@/pages/Medications/MedicationDrawPreview';
const syringe: MedicationSyringeInput = {
  name: 'Synthetic U100',
  graduation_type: 'units',
  units_per_ml: 100,
  capacity_ml: '1',
  capacity_units: 100,
  increment: '1',
};
function draw(value = '0.315', device = syringe): DrawResult {
  return {
    ...computeDraw({
      dose: { value, unit: 'mg' },
      concentrationMcgPerMl: '2500',
      syringe: device,
    }),
    syringeCapacityMl: device.capacity_ml,
  };
}
function show(preview: DrawResult) {
  render(
    <MedicationDrawPreview
      preview={preview}
      isFetching={false}
      isError={false}
    />
  );
}
const fill = () => screen.getByTestId('syringe-target-fill');
it('fills from target volume while preserving the rounded marking and delivered values', () => {
  show(draw());
  expect(Number(fill().getAttribute('width'))).toBeCloseTo(240 * 0.126);
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to 13 units' })
  ).toBeInTheDocument();
  expect(screen.getByText('Draw to 13 units')).toBeInTheDocument();
  expect(screen.getByText('325 mcg · 0.13 mL')).toBeInTheDocument();
});
it('shows shared source-rounded target equivalents, not delivered quantities', () => {
  show(draw());
  const group = screen.getByLabelText('Target dose equivalents');
  expect(within(group).getByText('315')).toBeInTheDocument();
  expect(within(group).getByText('0.315')).toBeInTheDocument();
  expect(within(group).getByText('0.126')).toBeInTheDocument();
  expect(within(group).getByText('12.6')).toBeInTheDocument();
  expect(within(group).queryByText('325')).not.toBeInTheDocument();
});
it('uses capacity from the authoritative response', () => {
  const result = draw();
  result.syringeCapacityMl = '0.5';
  show(result);
  expect(Number(fill().getAttribute('width'))).toBeCloseTo(240 * 0.252);
});
it('clamps overcapacity fill and colours any block as destructive', () => {
  show(draw('5'));
  expect(fill()).toHaveAttribute('width', '240');
  expect(fill()).toHaveClass('fill-destructive/60');
  expect(screen.getByText('Draw to 200 units')).toHaveClass(
    'bg-destructive',
    'text-destructive-foreground'
  );
});
it('also colours a remaining-stock block while keeping its actual target fill', () => {
  const result = draw();
  result.warnings = [
    {
      code: 'EXCEEDS_REMAINING_VIAL',
      severity: 'block',
      message: 'Synthetic stock block',
    },
  ];
  show(result);
  expect(Number(fill().getAttribute('width'))).toBeCloseTo(240 * 0.126);
  expect(fill()).toHaveClass('fill-destructive/60');
});
it('keeps a positive target with a zero rounded mark visible with warning styling only', () => {
  show(draw('0.001'));
  expect(Number(fill().getAttribute('width'))).toBeGreaterThan(0);
  expect(screen.getByText('Draw to 0 units')).toBeInTheDocument();
  expect(fill()).toHaveClass('fill-primary/50');
});
it('preserves exact sub-hundredth mL markings', () => {
  show(
    draw('0.0105', { ...syringe, graduation_type: 'ml', increment: '0.001' })
  );
  expect(screen.getByText('Draw to 0.004 mL')).toBeInTheDocument();
  expect(screen.getByText('Measurable marking: 0.004 mL')).toBeInTheDocument();
});
it('preserves text and target equivalents without guessing missing response capacity', () => {
  const result = draw();
  delete result.syringeCapacityMl;
  show(result);
  expect(
    screen.getByRole('img', { name: 'Syringe target fill: draw to —' })
  ).toBeInTheDocument();
  expect(fill()).toHaveAttribute('width', '0');
  expect(screen.getByText('Measurable marking: 13 units')).toBeInTheDocument();
  expect(screen.getByLabelText('Target dose equivalents')).toBeInTheDocument();
});

it.each([
  { isFetching: true, isError: false },
  { isFetching: false, isError: true },
])(
  'keeps a neutral figure and removes cached numeric results for %j',
  (flags) => {
    render(<MedicationDrawPreview preview={draw()} {...flags} />);
    expect(screen.getByText('Measurable marking: —')).toBeInTheDocument();
    expect(screen.getByText('Draw to —')).toBeInTheDocument();
    expect(fill()).toHaveAttribute('width', '0');
    expect(
      screen.queryByText('Measurable marking: 13 units')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Target dose equivalents')
    ).not.toBeInTheDocument();
  }
);
it('keeps the marking and empty figure visible before a valid amount exists', () => {
  render(<MedicationDrawPreview isFetching={false} isError={false} />);
  expect(screen.getByText('Measurable marking: —')).toBeInTheDocument();
  expect(screen.getByText('Draw to —')).toBeInTheDocument();
  expect(fill()).toHaveAttribute('width', '0');
});

it('labels the pump equivalent as the rounded marking count for a fractional pump target', () => {
  const pump = {
    name: 'Synthetic pump',
    device_type: 'pump' as const,
    graduation_type: 'ml' as const,
    units_per_ml: 100,
    capacity_ml: '5',
    capacity_units: 50,
    increment: '0.1',
  };
  const preview = {
    ...computeDraw({
      dose: { value: '0.14', unit: 'ml' },
      concentrationMcgPerMl: '2000',
      syringe: pump,
    }),
    device: { ...pump, id: 'pump' },
  };
  render(
    <MedicationDrawPreview
      preview={preview}
      isFetching={false}
      isError={false}
    />
  );
  expect(screen.getByText('Pumps (rounded)')).toBeInTheDocument();
  expect(
    screen.getByText('Measurable marking: 1 pump (0.1 mL)')
  ).toBeInTheDocument();
  expect(screen.queryByText('units')).not.toBeInTheDocument();
});
it('uses device-neutral validation wording for a pump preview error', () => {
  render(
    <MedicationDrawPreview deviceType="pump" isFetching={false} isError />
  );
  expect(
    screen.getByText(
      'Could not calculate a marking. Check the entered amount and device settings.'
    )
  ).toBeInTheDocument();
});
