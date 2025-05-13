import { atom } from 'nanostores';

export const menuStore = atom<boolean>(false);

export function toggleMenu() {
  menuStore.set(!menuStore.get());
}

export function openMenu() {
  menuStore.set(true);
}

export function closeMenu() {
  menuStore.set(false);
}
