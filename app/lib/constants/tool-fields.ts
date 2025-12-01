/**
 * Tool field name constants - Single source of truth
 * Shared between client and server code
 */

/**
 * Submit file action field names
 */
export const SUBMIT_FILE_ACTION_FIELDS = {
  PATH: 'path',
  CONTENT: 'content',
} as const;

/**
 * Submit modify action field names
 */
export const SUBMIT_MODIFY_ACTION_FIELDS = {
  PATH: 'path',
  ITEMS: 'items',
  BEFORE: 'before',
  AFTER: 'after',
} as const;

/**
 * Submit shell action field names
 */
export const SUBMIT_SHELL_ACTION_FIELDS = {
  COMMAND: 'command',
} as const;
