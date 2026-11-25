import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import BodyCompReportFields from '@/pages/Labs/BodyCompReportFields';
import { makeScan } from './bodyCompTestKit';

jest.mock('react-i18next', () =>
  jest.requireActual('@/tests/mocks/reactI18next')
);

const stat = (label: string) => screen.getByText(label).parentElement!;

describe('BodyCompReportFields', () => {
  it('says "not printed" for the % fat percentiles and shows the Z-score dash', () => {
    render(<BodyCompReportFields scan={makeScan()} />);
    expect(
      within(stat('% fat percentile (young-normal)')).getByText('not printed')
    ).toBeInTheDocument();
    expect(
      within(stat('% fat percentile (age-matched)')).getByText('not printed')
    ).toBeInTheDocument();
    expect(within(stat('BMD Z-score')).getByText('—')).toBeInTheDocument();
    expect(
      screen.queryByText('FMI percentile (young-normal)')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('BMD T-score')).not.toBeInTheDocument();
    expect(screen.queryByText('Site BMD CV %')).not.toBeInTheDocument();
  });

  it('shows the printed percentiles, scores and site CV', () => {
    render(
      <BodyCompReportFields
        scan={makeScan({
          age_years: 55,
          pct_fat_yn: 62,
          pct_fat_am: 41,
          fmi_yn: 70,
          lmi_am: 33,
          almi_yn: 50,
          bmd_z_score: -0.3,
          bmd_t_score: 0.9,
          bmd_cv_pct: 0.75,
        })}
      />
    );
    expect(
      within(stat('% fat percentile (young-normal)')).getByText('62')
    ).toBeInTheDocument();
    expect(
      within(stat('% fat percentile (age-matched)')).getByText('41')
    ).toBeInTheDocument();
    expect(
      within(stat('FMI percentile (young-normal)')).getByText('70')
    ).toBeInTheDocument();
    expect(
      within(stat('LMI percentile (age-matched)')).getByText('33')
    ).toBeInTheDocument();
    expect(
      within(stat('ALMI percentile (young-normal)')).getByText('50')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('FMI percentile (age-matched)')
    ).not.toBeInTheDocument();
    expect(within(stat('BMD Z-score')).getByText('−0.3')).toBeInTheDocument();
    expect(within(stat('BMD T-score')).getByText('+0.9')).toBeInTheDocument();
    expect(
      within(stat('Site BMD CV %')).getByText('0.75 %')
    ).toBeInTheDocument();
  });

  it('hides the T-score under 50', () => {
    render(
      <BodyCompReportFields
        scan={makeScan({ age_years: 49, bmd_t_score: 1 })}
      />
    );
    expect(screen.queryByText('BMD T-score')).not.toBeInTheDocument();
  });

  it('shows the device, scan mode and reference population when printed', () => {
    render(
      <BodyCompReportFields
        scan={makeScan({
          scan_mode: 'Fast array',
          reference_population: 'NHANES 2008',
        })}
      />
    );
    expect(
      within(stat('Device')).getByText('Hologic Horizon A · 13.6')
    ).toBeInTheDocument();
    expect(
      within(stat('Scan mode')).getByText('Fast array')
    ).toBeInTheDocument();
    expect(
      within(stat('Reference population')).getByText('NHANES 2008')
    ).toBeInTheDocument();
  });

  it('prints the population note', () => {
    render(<BodyCompReportFields scan={makeScan()} />);
    expect(
      screen.getByText(
        "Population position, not a target. Percentiles are as printed against the scanner's reference population; the report names it."
      )
    ).toBeInTheDocument();
  });
});
