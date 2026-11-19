import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import MedicationCourseRampGenerator from '@/pages/Medications/MedicationCourseRampGenerator';

const setup = (hasPhases = false, disabled = false) => {
  const onGenerate = jest.fn();
  render(
    <MedicationCourseRampGenerator
      unit="mg"
      hasPhases={hasPhases}
      disabled={disabled}
      onGenerate={onGenerate}
    />
  );
  fireEvent.click(screen.getByText('Generate phases from a ramp'));
  return onGenerate;
};
const fill = (start: string, target: string, increase: string, weeks = '4') => {
  fireEvent.change(screen.getByLabelText('Start dose (mg)'), {
    target: { value: start },
  });
  fireEvent.change(screen.getByLabelText('Target dose (mg)'), {
    target: { value: target },
  });
  fireEvent.change(screen.getByLabelText('Increase by (mg)'), {
    target: { value: increase },
  });
  fireEvent.change(screen.getByLabelText('Weeks per phase'), {
    target: { value: weeks },
  });
};

it('builds editable phases and says how many were made', () => {
  const onGenerate = setup();
  fill('0.25', '1', '0.25');
  fireEvent.click(screen.getByRole('button', { name: 'Generate phases' }));
  expect(onGenerate).toHaveBeenCalledWith([
    { dose: '0.25', dose_unit: 'mg', duration_days: 28, notes: null },
    { dose: '0.5', dose_unit: 'mg', duration_days: 28, notes: null },
    { dose: '0.75', dose_unit: 'mg', duration_days: 28, notes: null },
    { dose: '1', dose_unit: 'mg', duration_days: null, notes: null },
  ]);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Created 4 phases below. Review them, then save the course.'
  );
});

it('explains a problem and builds nothing', () => {
  const onGenerate = setup();
  fill('2', '1', '0.25');
  fireEvent.click(screen.getByRole('button', { name: 'Generate phases' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The start dose must not be above the target dose.'
  );
  expect(onGenerate).not.toHaveBeenCalled();
  fill('1', '1000', '1');
  fireEvent.click(screen.getByRole('button', { name: 'Generate phases' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/more than 100 phases/);
});

it('says it replaces existing phases, and clears the message when edited', () => {
  setup(true);
  fill('1', '1', '1');
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Replace the phases below with this ramp',
    })
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Created 1 phase below. Review it'
  );
  fireEvent.change(screen.getByLabelText('Weeks per phase'), {
    target: { value: '2' },
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('is inert while the course is locked', () => {
  const onGenerate = setup(false, true);
  expect(screen.getByLabelText('Start dose (mg)')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Generate phases' }));
  expect(onGenerate).not.toHaveBeenCalled();
});
