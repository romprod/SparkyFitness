import type { ComponentType, ReactNode } from 'react';
import WidgetGrid from '@/components/widgets/WidgetGrid';
import {
  generateDefaultLayouts,
  isMealWidgetKey,
  type DashboardLayouts,
  GRID_COLS,
  type Breakpoint,
} from '@/utils/dashboardLayout';

export interface DiaryWidget {
  key: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  render: () => ReactNode;
}

interface DiaryWidgetGridProps {
  widgets: DiaryWidget[];
  toolbarContainer?: HTMLElement | null;
}

const PAGE_KEY = 'diary';

const CHART_PLACEMENT = { key: 'glp1', after: 'caffeine' };
const diaryDefaultLayouts = (widgetKeys: string[]): DashboardLayouts => {
  const layouts = generateDefaultLayouts(widgetKeys.filter(isMealWidgetKey));
  for (const bp of Object.keys(layouts) as Breakpoint[]) {
    layouts[bp] = layouts[bp].filter((it) => widgetKeys.includes(it.i));
    if (widgetKeys.includes('glp1')) {
      const bottom = layouts[bp].reduce((y, it) => Math.max(y, it.y + it.h), 0);
      layouts[bp].push({
        i: 'glp1',
        x: 0,
        y: bottom,
        w: GRID_COLS[bp],
        h: 15,
        minW: GRID_COLS[bp],
        minH: 7,
      });
    }
  }
  return layouts;
};

const DiaryWidgetGrid = ({
  widgets,
  toolbarContainer,
}: DiaryWidgetGridProps) => (
  <WidgetGrid
    pageKey={PAGE_KEY}
    missingWidgetPlacement={CHART_PLACEMENT}
    widgets={widgets}
    generateDefaultLayouts={diaryDefaultLayouts}
    toolbarContainer={toolbarContainer}
  />
);

export default DiaryWidgetGrid;
