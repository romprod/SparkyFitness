import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import WidgetGrid from '@/components/widgets/WidgetGrid';
import type { DashboardLayouts } from '@/utils/dashboardLayout';
const mockSave = jest.fn();
const mockReset = jest.fn();
const base = { i: 'caffeine', x: 0, y: 0, w: 12, h: 11 };
const follower = { i: 'water', x: 0, y: 30, w: 12, h: 8 };
const all = (items: DashboardLayouts['lg']): DashboardLayouts => ({
  lg: items,
  md: items,
  sm: items,
  xs: items,
});
const mockSaved = {
  layout: all([base, follower]),
  hidden: [],
  updated_at: '2026-11-15T00:00:00Z',
};
jest.mock('@/hooks/Diary/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    saved: mockSaved,
    save: mockSave,
    reset: mockReset,
    isLoading: false,
  }),
}));
jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ isActingOnBehalf: false, activeUserId: 'owner' }),
}));
let mockGrid: {
  layouts: DashboardLayouts;
  onDragStop: () => void;
  onLayoutChange: (current: unknown, all: DashboardLayouts) => void;
};
jest.mock('react-grid-layout', () => ({
  useContainerWidth: () => ({
    width: 1200,
    containerRef: () => {},
    mounted: true,
  }),
  Responsive: (props: typeof mockGrid & { children: React.ReactNode }) => {
    mockGrid = props;
    return <div>{props.children}</div>;
  },
}));
jest.mock('@/components/widgets/WidgetFrame', () => ({
  __esModule: true,
  default: function MockWidgetFrame({
    widgetKey,
    onMeasure,
    children,
  }: {
    widgetKey: string;
    onMeasure: (key: string, px: number) => void;
    children: React.ReactNode;
  }) {
    React.useEffect(() => {
      if (widgetKey === 'glp1') onMeasure(widgetKey, 1392);
    }, [widgetKey, onMeasure]);
    return <div>{children}</div>;
  },
}));
it('persists the first real manual GLP drag rather than the prior automatic position', () => {
  const defaults = () =>
    all([base, follower, { i: 'glp1', x: 0, y: 38, w: 12, h: 15 }]);
  const widgets = ['caffeine', 'water', 'glp1'].map((key) => ({
    key,
    title: key,
    icon: () => null,
    render: () => null,
  }));
  render(
    <WidgetGrid
      pageKey="diary"
      widgets={widgets}
      generateDefaultLayouts={defaults}
      missingWidgetPlacement={{ key: 'glp1', after: 'caffeine' }}
    />
  );
  expect(mockGrid.layouts.lg.find((it) => it.i === 'glp1')).toMatchObject({
    y: 38,
    h: 32,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
  const dragged = all(
    mockGrid.layouts.lg.map((it) => (it.i === 'glp1' ? { ...it, y: 90 } : it))
  );
  act(() => {
    mockGrid.onDragStop();
    mockGrid.onLayoutChange([], dragged);
  });
  expect(
    mockSave.mock.calls
      .at(-1)?.[0]
      .layout.lg.find((it: { i: string }) => it.i === 'glp1')
  ).toMatchObject({ y: 90, h: 32 });
  expect(mockGrid.layouts.lg.find((it) => it.i === 'glp1')).toMatchObject({
    y: 90,
    h: 32,
  });
});
