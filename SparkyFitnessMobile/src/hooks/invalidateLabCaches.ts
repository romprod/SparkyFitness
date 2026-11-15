import type { QueryClient } from '@tanstack/react-query';
import {
  labComparisonQueryKey,
  labPanelsQueryKey,
  labHistoryRootQueryKey,
  labLatestQueryKey,
  labMarkersQueryKey,
} from './queryKeys';

/** Results, imports and marker edits all affect the same lab views. */
export function invalidateLabCaches(client: QueryClient): void {
  for (const queryKey of [
    labMarkersQueryKey,
    labLatestQueryKey,
    labHistoryRootQueryKey,
    labComparisonQueryKey,
    labPanelsQueryKey,
  ]) {
    void client.invalidateQueries({ queryKey });
  }
}
