/**
 * CaptureService.ts
 * Services that capture the screen and send it to a parent window
 */

import { sendMessageToParent } from './postMessageUtils';

/**
 * Initialize the capture service
 */
export const initCaptureService = () => {
  // Register listeners after the page has fully loaded
  if (document.readyState === 'complete') {
    initCaptureListener();
  } else {
    window.addEventListener('load', () => {
      initCaptureListener();
    });
  }
};

/**
 * Capture the current screen and send it to the parent page
 */
export const captureAndSend = async () => {
  try {
    const bodyStyles = window.getComputedStyle(document.body);
    const bodyColor = bodyStyles.backgroundColor;

    // html2canvas dynamic import
    const html2canvas = (await import('html2canvas')).default;

    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: bodyColor,
      scale: window.devicePixelRatio || 1,
      logging: false,
      foreignObjectRendering: true,
      onclone: (documentClone) => {
        return documentClone;
      },
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    });

    const imageData = canvas.toDataURL('image/png');

    sendMessageToParent('CAPTURE_SCREENSHOT', { imageData });

    return true;
  } catch (error) {
    console.error('[Agent8] Failed to capture a screenshot:', error);
    return false;
  }
};

/**
 * Register as a capture request listener on the parent page
 */
export const initCaptureListener = () => {
  window.addEventListener('message', async (event) => {
    try {
      if (event.data && typeof event.data === 'object') {
        if (event.data.type === 'REQUEST_SCREENSHOT') {
          // Processing after a slight delay for reliable capture
          setTimeout(() => {
            captureAndSend();
          }, 100);
        } else if (event.data.type === 'INIT') {
          sendMessageToParent('CAPTURE_READY', { status: 'ready' });
        }
      }
    } catch (error) {
      console.error('[Agent8] An error occurred during capture processing.:', error);
    }
  });
};
