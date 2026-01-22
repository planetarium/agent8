/**
 * Executes a function in the next event loop tick.
 * If the context is destroyed (e.g., due to iframe removal), this function may not execute.
 * Primarily used to prevent unnecessary error handling during component unmount.
 */
export function runInNextTick(callback: () => void) {
  setTimeout(callback, 0);
}
