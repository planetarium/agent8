import { atom } from 'nanostores';

const STORAGE_KEY = 'agent8_use_diff';

// Initialize from localStorage if available
const getInitialValue = (): boolean => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'true';
  }

  return false;
};

export const useDiffStore = atom<boolean>(getInitialValue());

// Subscribe to changes and save to localStorage
if (typeof window !== 'undefined') {
  useDiffStore.subscribe((value) => {
    localStorage.setItem(STORAGE_KEY, String(value));
  });
}

export function setUseDiff(value: boolean) {
  useDiffStore.set(value);
}
