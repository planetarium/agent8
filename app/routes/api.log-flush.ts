import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { flushLogs } from '~/utils/access-log';

export async function action({ context }: ActionFunctionArgs) {
  try {
    const flushResponse = await flushLogs(context.env);

    if (flushResponse.ok) {
      return json({
        success: true,
        message: 'Logs flushed successfully',
        timestamp: new Date().toISOString(),
      });
    } else {
      const errorText = await flushResponse.text().catch(() => 'Unable to read error response');

      return json(
        {
          success: false,
          message: 'Flush failed',
          error: `HTTP ${flushResponse.status}: ${errorText}`,
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('Failed to flush logs:', error);

    return json(
      {
        success: false,
        message: 'Failed to flush logs',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
