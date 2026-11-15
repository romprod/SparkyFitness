export const labKeys = {
  all: ['labs'] as const,
  markers: () => [...labKeys.all, 'markers'] as const,
  latest: () => [...labKeys.all, 'latest'] as const,
  panels: () => [...labKeys.all, 'panels'] as const,
  comparison: () => [...labKeys.all, 'comparison'] as const,
  histories: () => [...labKeys.all, 'history'] as const,
  history: (marker: string) => [...labKeys.histories(), marker] as const,
};
