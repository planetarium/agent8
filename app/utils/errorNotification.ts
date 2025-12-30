import { createScopedLogger } from '~/utils/logger';
import { toast } from 'react-toastify';
import { getErrorFilter } from '~/constants/errorFilters';

const logger = createScopedLogger('ErrorNotificationUtil');

const MAX_PROMPT_LENGTH = 200;
interface ErrorNotificationOptions {
  message: string;
  error?: Error | string;
  context?: string;
  userId?: string;
  prompt?: string;
  elapsedTime?: number;
  process?: string;
}

export async function sendErrorNotification(options: ErrorNotificationOptions): Promise<void> {
  try {
    let errorObj = {};
    let lastUserPrompt = options.prompt;

    if (lastUserPrompt && lastUserPrompt.length > MAX_PROMPT_LENGTH) {
      lastUserPrompt = `${lastUserPrompt.substring(0, MAX_PROMPT_LENGTH)}\n\n... (truncated)`;
    }

    if (options.error instanceof Error) {
      errorObj = {
        name: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
        ...Object.getOwnPropertyNames(options.error).reduce(
          (acc, key) => {
            if (!['name', 'message', 'stack'].includes(key)) {
              acc[key] = (options.error as any)[key];
            }

            return acc;
          },
          {} as Record<string, any>,
        ),
      };
    } else if (typeof options.error === 'string') {
      errorObj = {
        message: options.error,
      };
    }

    // Create a plain object with all Error properties for better serialization
    errorObj = {
      ...errorObj,
      prompt: lastUserPrompt,
      elapsedTime: options.elapsedTime,
      process: options.process,
    };

    const errorDetails = JSON.stringify(errorObj, null, 2);

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
  process?: string,
): Promise<void> {
  const context = `Chat - ${functionContext || 'Unknown function'}`;

  await sendErrorNotification({
    message: toastMessage, // Use the same message that's shown in toast
    error,
    context,
    prompt,
    elapsedTime,
    process,
  });
}

export interface HandleChatErrorOptions {
  error?: Error | string;
  context?: string;
  prompt?: string;
  elapsedTime?: number;
  toastType?: 'error' | 'warning';
  sendChatError?: boolean;
  process?: string;
}

// Comprehensive error handler that handles both toast and Slack notification
export function handleChatError(message: string, options?: HandleChatErrorOptions): void {
  const { error, context, prompt, elapsedTime, toastType = 'error', sendChatError = true, process } = options ?? {};

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

  // Send Slack notification only if error is not filtered and sendChatError is true (don't await to avoid blocking UI)
  if (!filter && sendChatError) {
    sendChatErrorWithToastMessage(message, error, context, prompt, elapsedTime, process).catch((notificationError) => {
      logger.error('Failed to send error notification for:', message, notificationError);
    });
  }
}
