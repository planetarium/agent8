import { createScopedLogger } from '~/utils/logger';
import { toast } from 'react-toastify';

const logger = createScopedLogger('ErrorNotificationUtil');

interface ErrorNotificationOptions {
  message: string;
  error?: Error | string;
  context?: string;
  userId?: string;
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

        // Include any custom properties that might exist on the error
        ...Object.getOwnPropertyNames(options.error).reduce((acc, key) => {
          if (!['name', 'message', 'stack'].includes(key)) {
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

// Convenience function for chat-related errors
export async function sendChatErrorNotification(
  message: string,
  error?: Error | string,
  additionalContext?: string,
): Promise<void> {
  const context = `Chat - ${additionalContext || 'Unknown context'}`;

  await sendErrorNotification({
    message,
    error,
    context,
  });
}

// Convenience function for sending toast message errors with stack trace context
export async function sendChatErrorWithToastMessage(
  toastMessage: string,
  error?: Error | string,
  functionContext?: string,
): Promise<void> {
  const context = `Chat - ${functionContext || 'Unknown function'}`;

  await sendErrorNotification({
    message: toastMessage, // Use the same message that's shown in toast
    error,
    context,
  });
}

// Comprehensive error handler that handles both toast and Slack notification
export function handleChatError(
  message: string,
  error?: Error | string,
  context?: string,
  toastType: 'error' | 'warning' = 'error',
): void {
  // Show toast notification
  if (toastType === 'error') {
    toast.error(message);
  } else {
    toast.warning(message);
  }

  // Send Slack notification (don't await to avoid blocking UI)
  sendChatErrorWithToastMessage(message, error, context).catch((notificationError) => {
    logger.error('Failed to send error notification for:', message, notificationError);
  });
}
