import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCycleSettings } from '@/hooks/useCycle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CycleToday from './CycleToday';
import PregnancyToday from './pregnancy/PregnancyToday';
import CycleOnboarding from './CycleOnboarding';
import CycleInsights from './CycleInsights';
import CareHub from './care/CareHub';

export default function CyclePage() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useCycleSettings();
  const [activeTab, setActiveTab] = useState('today');

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-10 w-full animate-pulse rounded-md bg-muted/40" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
        <div className="h-48 animate-pulse rounded-2xl bg-muted/40" />
      </div>
    );
  }

  // If not enabled, or not onboarded, show onboarding wizard.
  if (!settings?.enabled || !settings?.onboarded_at) {
    return <CycleOnboarding />;
  }

  return (
    <div className="space-y-6 w-full p-2 sm:p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {settings.mode === 'pregnant'
            ? t('cycle.pregnancyHub', 'Pregnancy Hub')
            : t('cycle.hub', 'Cycle & Pregnancy Hub')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'cycle.hubSubtitle',
            'Track, understand, and sync with your body.'
          )}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="today" className="rounded-lg py-2">
            {t('cycle.tabs.log', 'Log')}
          </TabsTrigger>
          <TabsTrigger value="insights" className="rounded-lg py-2">
            {t('cycle.tabs.insights', 'Insights')}
          </TabsTrigger>
          <TabsTrigger value="care" className="rounded-lg py-2">
            {t('cycle.tabs.care', 'Care')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4 focus-visible:outline-none">
          {settings.mode === 'pregnant' ? <PregnancyToday /> : <CycleToday />}
        </TabsContent>

        <TabsContent
          value="insights"
          className="mt-4 focus-visible:outline-none"
        >
          <CycleInsights />
        </TabsContent>

        <TabsContent value="care" className="mt-4 focus-visible:outline-none">
          <CareHub mode={settings.mode} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
