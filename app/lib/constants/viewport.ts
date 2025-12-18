/**
 * Viewport breakpoint constants for responsive design
 *
 * These values are used with useViewport hook to determine
 * when to switch between mobile and desktop layouts.
 */

/**
 * Mobile breakpoint when workbench is visible
 * Used for: Header, Workbench, Preview, Modals, etc.
 */
export const MOBILE_BREAKPOINT = 1003;

/**
 * Mobile breakpoint for chat area before workbench is mounted
 * Slightly larger to account for chat-only layout
 */
export const CHAT_MOBILE_BREAKPOINT = 1072;

/**
 * Breakpoint for header action buttons
 */
export const HEADER_ACTIONS_BREAKPOINT = 1024;
