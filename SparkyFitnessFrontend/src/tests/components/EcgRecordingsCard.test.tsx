import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import type { EcgRecordingSummary } from '@workspace/shared';
import EcgRecordingsCard from '@/pages/Labs/EcgRecordingsCard';
import { detail, summary } from './ecgFixtures';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_m, key: string) =>
        String(values?.[key] ?? '')
      ),
  }),
}));
let mockList: {
  data?: EcgRecordingSummary[];
  isLoading?: boolean;
  isError?: boolean;
} = {};
let mockDetail: { data?: unknown; isError?: boolean } = {};
const mockDetailHook = jest.fn();
jest.mock('@/hooks/Labs/useEcgRecordings', () => ({
  useEcgRecordings: () => mockList,
  useEcgRecording: (id: string | null) => {
    mockDetailHook(id);
    return mockDetail;
  },
  useEcgImport: () => ({
    start: jest.fn(),
    busy: false,
    error: null,
    outcomes: null,
  }),
}));
const mockOpen = jest.fn();
jest.mock('@/hooks/Labs/useHealthDocuments', () => ({
  useOpenHealthDocumentMutation: () => ({
    mutate: mockOpen,
    isPending: false,
    isError: false,
  }),
}));

const renderCard = () =>
  render(
    <MemoryRouter>
      <EcgRecordingsCard />
    </MemoryRouter>
  );

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const many = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    summary({
      id: id(i + 1),
      result: i === 0 ? 'Sinus Rhythm' : `Result ${i}`,
      avg_heart_rate_bpm: 60 + i,
      symptoms: '--',
    })
  );

beforeEach(() => {
  mockList = { data: [] };
  mockDetail = {};
  mockDetailHook.mockReset();
  mockOpen.mockReset();
});

describe('EcgRecordingsCard', () => {
  it('shows the empty state and the full import hint with no recordings', () => {
    renderCard();
    expect(screen.getByText('ECG')).toBeInTheDocument();
    expect(
      screen.getByText('Single-lead recordings from your watch.')
    ).toBeInTheDocument();
    expect(screen.getByText('No ECG recordings yet')).toBeInTheDocument();
    expect(
      screen.getByText(/arrive here as the PDF it shares/)
    ).toBeInTheDocument();
    expect(screen.getByText(/share it as a PDF/)).toBeInTheDocument();
    expect(screen.queryByText(/All \d+ recordings/)).toBeNull();
  });

  it('draws the latest in full, fetching its trace by id, with earlier rows beneath', () => {
    mockList = { data: many(3) };
    mockDetail = { data: detail({ id: id(1) }) };
    renderCard();
    expect(mockDetailHook).toHaveBeenCalledWith(id(1));
    expect(
      screen.getByText('3 recordings from your watch.')
    ).toBeInTheDocument();
    // Latest: heading links to its page, interpretation is verbatim, trace is drawn.
    const heading = screen.getByRole('heading', { name: 'Sinus Rhythm' });
    expect(within(heading).getByRole('link')).toHaveAttribute(
      'href',
      `/labs/ecg/${id(1)}`
    );
    expect(
      screen.getByText('This ECG recording does not show signs of AFib.')
    ).toBeInTheDocument();
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    // Earlier rows link to their own page.
    expect(screen.getByText('Earlier recordings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Result 1/ })).toHaveAttribute(
      'href',
      `/labs/ecg/${id(2)}`
    );
    expect(screen.getByRole('link', { name: /Result 2/ })).toHaveAttribute(
      'href',
      `/labs/ecg/${id(3)}`
    );
    expect(
      screen.getByRole('link', { name: /All 3 recordings/ })
    ).toHaveAttribute('href', '/labs/ecg');
    expect(
      screen.getByText('PDFs from Garmin Connect. Drop several at once.')
    ).toBeInTheDocument();
  });

  it('lists at most five earlier recordings', () => {
    mockList = { data: many(9) };
    mockDetail = { data: detail({ id: id(1) }) };
    renderCard();
    const earlier = screen.getByText('Earlier recordings').parentElement!;
    expect(within(earlier).getAllByRole('listitem')).toHaveLength(5);
    expect(
      screen.getByRole('link', { name: /All 9 recordings/ })
    ).toBeInTheDocument();
  });

  it('shows a symptoms pill on an earlier row only when symptoms were reported', () => {
    mockList = {
      data: [
        summary({ id: id(1) }),
        summary({ id: id(2), result: 'Quiet', symptoms: '--' }),
        summary({ id: id(3), result: 'Noted', symptoms: 'Palpitations' }),
        summary({ id: id(4), result: 'Unread', symptoms: null }),
      ],
    };
    mockDetail = { data: detail({ id: id(1) }) };
    renderCard();
    const row = (name: RegExp) =>
      screen.getByRole('link', { name }).closest('li')!;
    expect(within(row(/Noted/)).getByText('Palpitations')).toBeInTheDocument();
    expect(within(row(/Quiet/)).queryByText('None reported')).toBeNull();
    expect(within(row(/Quiet/)).queryByText('--')).toBeNull();
    expect(within(row(/Unread/)).queryByText('—')).toBeNull();
  });

  it("shows bpm and the time in the recording's own zone on a row", () => {
    mockList = {
      data: [
        summary({ id: id(1) }),
        summary({
          id: id(2),
          result: 'Other',
          avg_heart_rate_bpm: 77,
          recorded_at: '2026-07-01T23:30:00.000Z',
          tz: 'Pacific/Auckland',
        }),
      ],
    };
    mockDetail = { data: detail({ id: id(1) }) };
    renderCard();
    const row = screen.getByRole('link', { name: /Other/ });
    expect(within(row).getByText('77 bpm')).toBeInTheDocument();
    // 23:30Z is 11:30 the next morning in Auckland (UTC+12 in July).
    expect(within(row).getByText(/2 Jul 2026|Jul 2, 2026/)).toBeInTheDocument();
  });

  it('shows the symptoms stat as Garmin printed it', () => {
    mockList = { data: [summary({ symptoms: 'Dizziness, Fatigue' })] };
    mockDetail = { data: detail({ symptoms: 'Dizziness, Fatigue' }) };
    renderCard();
    expect(screen.getByText('Symptoms')).toBeInTheDocument();
    expect(screen.getByText('Dizziness, Fatigue')).toBeInTheDocument();
  });

  it('says None reported for the printed dashes', () => {
    mockList = { data: [summary()] };
    mockDetail = { data: detail() };
    renderCard();
    expect(screen.getByText('None reported')).toBeInTheDocument();
  });

  it('says the trace could not be read when the report had none', () => {
    mockList = { data: [summary({ has_waveform: false })] };
    renderCard();
    expect(
      screen.getByText('The trace could not be read from this report.')
    ).toBeInTheDocument();
    expect(mockDetailHook).toHaveBeenCalledWith(null);
  });

  it('says so when the trace could not be loaded, which is not the same thing', () => {
    mockList = { data: [summary()] };
    mockDetail = { isError: true };
    renderCard();
    expect(
      screen.getByText('The trace could not be loaded.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('The trace could not be read from this report.')
    ).toBeNull();
  });

  it('shows the lead note, device and a button for the stored PDF', () => {
    mockList = { data: [summary()] };
    mockDetail = { data: detail() };
    renderCard();
    expect(screen.getByText('Lead I, single lead')).toBeInTheDocument();
    expect(screen.getByText('Forerunner 970 · 19.04')).toBeInTheDocument();
    screen.getByRole('button', { name: /Garmin's own report \(PDF\)/ }).click();
    expect(mockOpen).toHaveBeenCalledWith({
      id: summary().document_id,
      original_name: expect.any(String),
    });
  });

  it('offers no PDF link when no document is stored', () => {
    mockList = { data: [summary({ document_id: null })] };
    mockDetail = { data: detail({ document_id: null }) };
    renderCard();
    expect(screen.queryByRole('button', { name: /own report/ })).toBeNull();
  });

  it('says the load failed rather than showing the empty state', () => {
    mockList = { isError: true };
    renderCard();
    expect(
      screen.getByText('Could not load your ECG recordings.')
    ).toBeInTheDocument();
    expect(screen.queryByText('No ECG recordings yet')).toBeNull();
  });
});
