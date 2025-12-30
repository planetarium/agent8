import { atom } from 'nanostores';

export interface RestoreEvent {
  commitHash: string;
  commitTitle: string;
  timestamp: number;
}

export const restoreEventStore = atom<RestoreEvent | null>(null);

export function triggerRestoreEvent(commitHash: string, commitTitle: string) {
  restoreEventStore.set({
    commitHash,
    commitTitle,
    timestamp: Date.now(),
  });
}

export function clearRestoreEvent() {
  restoreEventStore.set(null);
}
