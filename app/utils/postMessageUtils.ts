/**
 * Utility functions to communicate with the parent page
 */

export const sendMessageToParent = (type: string, payload: any) => {
  try {
    if (window.parent !== window) {
      const messageData = { type, payload };

      window.parent.postMessage(messageData, '*');

      try {
        const currentOrigin = window.location.origin;
        window.parent.postMessage(messageData, currentOrigin);
      } catch (error) {
        console.error('[Agent8] Failed to send message to same origin:', error);
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('[Agent8] Failed to send message to parent:', error);
    return false;
  }
};

export const addMessageListener = (type: string, callback: (data: any) => void) => {
  const handler = (event: MessageEvent) => {
    /*
     * More provenance verification logic coming soon for security...
     * if (event.origin !== 'parent_domain') return;
     */

    if (event.data && event.data.type === type) {
      callback(event.data.payload);
    }
  };

  window.addEventListener('message', handler);

  return () => {
    window.removeEventListener('message', handler);
  };
};
