import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ErrorNotification');

interface ErrorNotificationPayload {
  message: string;
  error?: string;
  context?: string;
  timestamp?: string;
  userAgent?: string;
  url?: string;
  userId?: string;
  prompt?: string;
  elapsedTime?: number;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload: ErrorNotificationPayload = await request.json();

    // Validate required fields
    if (!payload.message) {
      return new Response('Missing required field: message', { status: 400 });
    }

    // Get Slack bot token and channel ID from environment variables
    const slackBotToken = env.SLACK_ALERT_BOT_TOKEN;
    const slackChannelId = env.SLACK_ALERT_CHANNEL_ID;

    if (!slackBotToken || !slackChannelId) {
      logger.warn('SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not configured, skipping Slack notification');
      return new Response('Slack bot not configured', { status: 200 });
    }

    // Prepare main Slack message (simple and clean)
    const mainMessage = {
      text: `🚨 Agent8 Error: ${payload.message}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🚨 *${payload.message}*\n\n*Context:* ${payload.context || 'N/A'}`,
          },
        },
      ],
    };

    // Send main message first using Slack API
    const mainResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: slackChannelId,
        text: mainMessage.text,
        blocks: mainMessage.blocks,
      }),
    });

    if (!mainResponse.ok) {
      throw new Error(`Slack main message API error: ${mainResponse.status} ${mainResponse.statusText}`);
    }

    const mainResult = (await mainResponse.json()) as any;

    if (!mainResult.ok) {
      throw new Error(`Slack API error: ${mainResult.error}`);
    }

    const messageTimestamp = mainResult.ts;

    // If there are additional details, send them as a follow-up message
    const hasAdditionalInfo = payload.error || payload.userAgent || payload.url || payload.userId;

    if (hasAdditionalInfo) {
      // Small delay to ensure messages appear in order
      await new Promise((resolve) => setTimeout(resolve, 500));

      const detailBlocks = [];

      // Add error details if available
      if (payload.error) {
        const maxErrorLength = 5000;
        const errorText =
          payload.error.length > maxErrorLength
            ? payload.error.substring(0, maxErrorLength) + '\n\n... (truncated)'
            : payload.error;

        detailBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📋 Error Details:*\n\`\`\`json\n${errorText}\`\`\``,
          },
        });
      }

      // Add user info if available
      if (payload.userAgent || payload.url || payload.userId) {
        const userFields = [];

        if (payload.userId) {
          userFields.push({
            type: 'mrkdwn',
            text: `*User ID:*\n${payload.userId}`,
          });
        }

        if (payload.url) {
          userFields.push({
            type: 'mrkdwn',
            text: `*URL:*\n${payload.url}`,
          });
        }

        if (payload.userAgent) {
          userFields.push({
            type: 'mrkdwn',
            text: `*User Agent:*\n${payload.userAgent.substring(0, 100)}`,
          });
        }

        if (userFields.length > 0) {
          detailBlocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🔍 Additional Information:*',
            },
          });
          detailBlocks.push({
            type: 'section',
            fields: userFields,
          });
        }
      }

      if (detailBlocks.length > 0) {
        const detailMessage = {
          text: '↳ Additional Error Details',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `↳ *Additional Details for:* ${payload.message}`,
              },
            },
            ...detailBlocks,
          ],
        };

        // Send detail message as thread reply using Slack API
        const detailResponse = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${slackBotToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: slackChannelId,
            text: detailMessage.text,
            blocks: detailMessage.blocks,
            thread_ts: messageTimestamp, // This makes it a thread reply
          }),
        });

        if (!detailResponse.ok) {
          logger.warn(`Failed to send detail message: ${detailResponse.status} ${detailResponse.statusText}`);

          // Don't throw here, main message was already sent successfully
        } else {
          const detailResult = (await detailResponse.json()) as any;

          if (!detailResult.ok) {
            logger.warn(`Slack API error for detail message: ${detailResult.error}`);
          }
        }
      }
    }

    logger.info('Error notification sent to Slack successfully');

    return new Response('OK', { status: 200 });
  } catch (error) {
    logger.error('Failed to send error notification to Slack:', error);
    return new Response('Failed to send notification', { status: 500 });
  }
}
