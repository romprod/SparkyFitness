import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import NutritionSummaryCard from '@/pages/Diary/NutritionSummaryCard';
import { DEFAULT_GOALS } from '@/constants/goals';
import type { NutrientGoalOverrideMap } from '@/utils/nutrientUtils';

let mockShowNetCarbs = false;
let mockVisibleNutrients = ['carbs'];
let mockGoalPreferences: NutrientGoalOverrideMap = {};

beforeEach(() => {
  mockGoalPreferences = {};
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    loggingLevel: 'ERROR',
    nutrientDisplayPreferences: [
      {
        view_group: 'summary',
        platform: 'desktop',
        visible_nutrients: mockVisibleNutrients,
      },
    ],
    showNetCarbs: mockShowNetCarbs,
  }),
}));

jest.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

jest.mock('@/pages/Diary/MiniNutritionTrends', () => () => (
  <div data-testid="mini-nutrition-trends" />
));

jest.mock('@/pages/Goals/EditGoalsForToday', () => () => (
  <button type="button">Edit Goals</button>
));

jest.mock('@/pages/Diary/CopyFoodEntryDialog', () => () => null);

jest.mock('@/hooks/Diary/useFoodEntries', () => ({
  useCopyAllFoodEntriesMutation: () => ({ mutate: jest.fn() }),
  useCopyAllFoodEntriesFromYesterdayMutation: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/hooks/Settings/useNutrientGoalPreferences', () => ({
  useNutrientGoalPreferences: () => ({ data: mockGoalPreferences }),
}));

const renderSummary = () =>
  render(
    <NutritionSummaryCard
      selectedDate="2026-05-15"
      dayTotals={{
        calories: 0,
        protein: 0,
        carbs: 30,
        fat: 0,
        dietary_fiber: 8,
      }}
      goals={{ ...DEFAULT_GOALS, carbs: 50 }}
      energyUnit="kcal"
      convertEnergy={(value) => value}
    />
  );

describe('NutritionSummaryCard net carbs summary', () => {
  beforeEach(() => {
    mockShowNetCarbs = false;
    mockVisibleNutrients = ['carbs'];
  });

  it('shows total carbohydrates by default', () => {
    renderSummary();

    expect(screen.getByText('Carbohydrates')).toBeInTheDocument();
    expect(screen.getByText('30.0g')).toBeInTheDocument();
  });

  it('shows net carbs and subtracts fiber when enabled', () => {
    mockShowNetCarbs = true;
    renderSummary();

    expect(screen.getByText('Net Carbs')).toBeInTheDocument();
    expect(screen.getByText('22.0g')).toBeInTheDocument();
    expect(screen.getByText('of 50.0g')).toBeInTheDocument();
  });
});

describe('NutritionSummaryCard calorie budget', () => {
  it('uses the activity-adjusted budget for the calorie label and bar', () => {
    mockVisibleNutrients = ['calories'];
    const { container } = render(
      <NutritionSummaryCard
        selectedDate="2026-10-24"
        dayTotals={{
          calories: 1225,
          protein: 0,
          carbs: 0,
          fat: 0,
          dietary_fiber: 0,
        }}
        goals={{ ...DEFAULT_GOALS, calories: 1800 }}
        calorieBudget={2481}
        energyUnit="kcal"
        convertEnergy={(value) => value}
      />
    );
    expect(screen.getByText('of 2481kcal')).toBeInTheDocument();
    const bar = container.querySelector<HTMLElement>(
      '.h-1\\.5.rounded-full[style]'
    );
    expect(parseFloat(bar?.style.width ?? '0')).toBeCloseTo(49.375);
  });
});

describe('NutritionSummaryCard goal completion', () => {
  it.each([
    ['minimum', 349.9, 350, false],
    ['minimum', 350, 350, true],
    ['minimum', 500.2, 350, true],
    ['minimum', 500.2, 0, false],
    ['maximum', 300, 350, true],
    ['maximum', 350, 350, true],
    ['maximum', 500.2, 350, false],
  ] as const)(
    '%s goal with %s consumed against %s shows completion: %s',
    (goalType, amount, goal, completed) => {
      mockVisibleNutrients = ['Magnesium'];
      mockGoalPreferences = { Magnesium: { goalType } };
      const { container } = render(
        <NutritionSummaryCard
          selectedDate="2026-11-11"
          dayTotals={{
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            dietary_fiber: 0,
            custom_nutrients: { Magnesium: amount },
          }}
          goals={{ ...DEFAULT_GOALS, custom_nutrients: { Magnesium: goal } }}
          customNutrients={[
            {
              id: 'magnesium',
              user_id: 'user',
              name: 'Magnesium',
              unit: 'mg',
              aliases: [],
              created_at: '',
              updated_at: '',
            },
          ]}
          energyUnit="kcal"
          convertEnergy={(value) => value}
        />
      );
      expect(Boolean(container.querySelector('svg.text-green-600'))).toBe(
        completed
      );
    }
  );

  it.each([
    [159, false],
    [160, true],
    [165, true],
    [170, true],
    [171, false],
  ])(
    'target range with %s consumed shows completion: %s',
    (amount, completed) => {
      mockVisibleNutrients = ['protein'];
      mockGoalPreferences = {
        protein: { goalType: 'target', targetMin: 160, targetMax: 170 },
      };
      const { container } = render(
        <NutritionSummaryCard
          selectedDate="2026-11-11"
          dayTotals={{
            calories: 0,
            protein: amount,
            carbs: 0,
            fat: 0,
            dietary_fiber: 0,
          }}
          goals={{ ...DEFAULT_GOALS, protein: 165 }}
          energyUnit="kcal"
          convertEnergy={(value) => value}
        />
      );
      expect(Boolean(container.querySelector('svg.text-green-600'))).toBe(
        completed
      );
    }
  );
});

it('hides only the optional trends while retaining the nutrition summary', () => {
  const props = {
    selectedDate: '2026-11-17',
    goals: DEFAULT_GOALS,
    energyUnit: 'kcal' as const,
    convertEnergy: (value: number) => value,
  };
  const view = render(<NutritionSummaryCard {...props} />);
  expect(screen.getByTestId('mini-nutrition-trends')).toBeInTheDocument();
  view.rerender(
    <NutritionSummaryCard {...props} showNutritionTrends={false} />
  );
  expect(screen.queryByTestId('mini-nutrition-trends')).not.toBeInTheDocument();
  expect(screen.getByText('Nutrition Summary')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Edit Goals' })
  ).toBeInTheDocument();
});
