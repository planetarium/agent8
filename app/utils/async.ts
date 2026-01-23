/**
 * Executes a function in the next event loop tick. (Simple delay)
 * Used to adjust execution order or break synchronous execution flow.
 */
export function runInNextTick(callback: () => void) {
  setTimeout(callback, 0);
}

/**
 * Defers to the next tick, then waits until the next frame (screen refresh) before executing. (Safe delay)
 * Used to prevent errors when the rendering context disappears, such as during iframe removal or component unmounting.
 */
export function runInNextFrame(callback: () => void) {
  setTimeout(() => {
    requestAnimationFrame(() => {
      callback();
    });
  }, 0);
}
