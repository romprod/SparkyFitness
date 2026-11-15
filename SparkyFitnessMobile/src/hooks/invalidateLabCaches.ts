import type { QueryClient } from '@tanstack/react-query';
import {
  labComparisonQueryKey,
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
  ]) {
    void client.invalidateQueries({ queryKey });
  }
}
