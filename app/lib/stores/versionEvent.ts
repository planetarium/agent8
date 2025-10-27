import { atom } from 'nanostores';

export interface VersionEvent {
  type: 'save' | 'delete';
  commitHash: string;
  timestamp: number;
}

export const versionEventStore = atom<VersionEvent | null>(null);

export function triggerVersionSave(commitHash: string) {
  versionEventStore.set({
    type: 'save',
    commitHash,
    timestamp: Date.now(),
  });
}

export function triggerVersionDelete(commitHash: string) {
  versionEventStore.set({
    type: 'delete',
    commitHash,
    timestamp: Date.now(),
  });
}

export function clearVersionEvent() {
  versionEventStore.set(null);
}
