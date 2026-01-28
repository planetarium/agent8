/**
 * Executes a function in the next event loop tick. (Simple delay)
 * Used to adjust execution order or break synchronous execution flow.
 */
export function runInNextTick(callback: () => void) {
  setTimeout(callback, 0);
}
