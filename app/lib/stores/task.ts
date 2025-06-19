import { atom } from 'nanostores';

/**
 * Store for task functionality
 * Contains a trigger that can be incremented to signal a refresh
 */
export const taskStore = atom({
  refreshTrigger: 0,
});

/**
 * Helper function to trigger a task refresh
 * Increments the refresh trigger to signal TaskList component to reload data
 */
export function triggerTaskRefresh() {
  taskStore.set({
    refreshTrigger: taskStore.get().refreshTrigger + 1,
  });
}
