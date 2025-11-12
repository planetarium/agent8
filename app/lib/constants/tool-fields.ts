/**
 * Tool field name constants - Single source of truth
 * Shared between client and server code
 */

/**
 * Generate artifact field names
 */
export const GENERATE_ARTIFACT_FIELDS = {
  ID: 'id',
  TITLE: 'title',
  SUMMARY: 'summary',
  ACTIONS: 'actions',
} as const;

export const ACTION_FIELDS = {
  TYPE: 'type',
  PATH: 'path',
  CONTENT: 'content',
  BEFORE: 'before',
  AFTER: 'after',
  COMMAND: 'command',
} as const;
