/**
 * Helper function to send postMessage to allowed parent origins
 */
export function sendMessageToParent(message: any) {
  if (window.parent && window.parent !== window) {
    const allowedOriginsEnv = import.meta.env.VITE_ALLOWED_PARENT_ORIGINS;
    const allowedOrigins = allowedOriginsEnv
      ? allowedOriginsEnv.split(',').map((origin: string) => origin.trim())
      : ['https://verse8.io']; // fallback
    const parentOrigin = document.referrer ? new URL(document.referrer).origin : null;
    const targetOrigin = parentOrigin && allowedOrigins.includes(parentOrigin) ? parentOrigin : allowedOrigins[0];

    window.parent.postMessage(message, targetOrigin);
  }
}
