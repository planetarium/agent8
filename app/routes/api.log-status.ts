import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getLogBufferStatus } from '~/utils/access-log';

export async function loader({ context }: LoaderFunctionArgs) {
  try {
    const statusResponse = await getLogBufferStatus(context.env);
    const status = await statusResponse.json();

    return json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get log buffer status:', error);

    return json(
      {
        success: false,
        error: 'Failed to get log buffer status',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
