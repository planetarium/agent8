import { createScopedLogger } from '~/utils/logger';
import { toast } from 'react-toastify';
import { getErrorFilter } from '~/constants/errorFilters';

const logger = createScopedLogger('ErrorNotificationUtil');

interface ErrorNotificationOptions {
  message: string;
  error?: Error | string;
  context?: string;
  userId?: string;
  prompt?: string;
  elapsedTime?: number;
}

export async function sendErrorNotification(options: ErrorNotificationOptions): Promise<void> {
  try {
    // Serialize error object completely to capture all properties
    let errorDetails: string;

    if (options.error instanceof Error) {
      // Create a plain object with all Error properties for better serialization
      const errorObj = {
        name: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
        prompt: options.prompt,
        elapsedTime: options.elapsedTime,

        // Include any custom properties that might exist on the error
        ...Object.getOwnPropertyNames(options.error).reduce((acc, key) => {
          if (!['name', 'message', 'stack', 'prompt', 'elapsedTime'].includes(key)) {
            acc[key] = (options.error as any)[key];
          }

          return acc;
        }, {} as any),
      };
      errorDetails = JSON.stringify(errorObj, null, 2);
    } else if (options.error) {
      errorDetails = JSON.stringify(options.error, null, 2);
    } else {
      errorDetails = '';
    }

    const payload = {
      message: options.message,
      error: errorDetails,
      context: options.context,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userId: options.userId,
    };

    const response = await fetch('/api/error-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to send error notification: ${response.status}`);
    }

    logger.debug('Error notification sent successfully');
  } catch (error) {
    // Don't throw here to avoid infinite loops
    logger.error('Failed to send error notification:', error);
  }
}

// Convenience function for sending toast message errors with stack trace context
export async function sendChatErrorWithToastMessage(
  toastMessage: string,
  error?: Error | string,
  functionContext?: string,
  prompt?: string,
  elapsedTime?: number,
): Promise<void> {
  const context = `Chat - ${functionContext || 'Unknown function'}`;

  await sendErrorNotification({
    message: toastMessage, // Use the same message that's shown in toast
    error,
    context,
    prompt,
    elapsedTime,
  });
}

// Comprehensive error handler that handles both toast and Slack notification
export function handleChatError(
  message: string,
  error?: Error | string,
  context?: string,
  prompt?: string,
  elapsedTime?: number,
  toastType: 'error' | 'warning' = 'error',
): void {
  // Check if error matches any filter
  const filter = getErrorFilter(error);

  // Use replacement message if available, otherwise use original message
  const displayMessage = filter?.replacementMessage || message;

  // Show toast notification
  if (toastType === 'error') {
    toast.error(displayMessage);
  } else {
    toast.warning(displayMessage);
  }

  // Send Slack notification only if error is not filtered (don't await to avoid blocking UI)
  if (!filter) {
    sendChatErrorWithToastMessage(message, error, context, prompt, elapsedTime).catch((notificationError) => {
      logger.error('Failed to send error notification for:', message, notificationError);
    });
  }
}
