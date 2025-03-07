import { atom } from 'nanostores';
import { logStore } from './logs';

export type Theme = 'dark' | 'light';

export const kTheme = 'bolt_theme';

export function themeIsDark() {
  return themeStore.get() === 'dark';
}

export const DEFAULT_THEME = 'dark';

export const themeStore = atom<Theme>(initStore());

function initStore() {
  if (!import.meta.env.SSR) {
    localStorage.setItem(kTheme, 'dark');
    document.querySelector('html')?.setAttribute('data-theme', 'dark');

    return 'dark' as Theme;
  }

  return DEFAULT_THEME;
}

export function toggleTheme() {
  const currentTheme = themeStore.get();

  if (currentTheme === 'dark') {
    return;
  }

  const newTheme: Theme = 'dark';

  themeStore.set(newTheme);

  localStorage.setItem(kTheme, newTheme);

  document.querySelector('html')?.setAttribute('data-theme', newTheme);

  try {
    const userProfile = localStorage.getItem('bolt_user_profile');

    if (userProfile) {
      const profile = JSON.parse(userProfile);
      profile.theme = newTheme;
      localStorage.setItem('bolt_user_profile', JSON.stringify(profile));
    }
  } catch (error) {
    console.error('Error updating user profile theme:', error);
  }

  logStore.logSystem(`Theme changed to ${newTheme} mode`);
}
