import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { ContainerFactory } from '~/lib/container/factory';
import type { ContainerOptions } from '~/lib/container/interfaces';
import { createScopedLogger } from '~/utils/logger';

// import { verifyV8AccessToken } from '~/lib/verse8/userAuth';

const logger = createScopedLogger('container-api');

// GET /api/container - Return 405 Method Not Allowed
export async function loader() {
  return json(
    {
      error: 'Method not allowed',
      allowedMethods: ['POST'],
      message: 'This endpoint supports POST method only',
    },
    {
      status: 405,
      headers: {
        Allow: 'POST',
      },
    },
  );
}

// POST /api/container - Create new container
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json(
      {
        error: 'Method not allowed',
        allowedMethods: ['POST'],
        message: 'This endpoint supports POST method only',
      },
      {
        status: 405,
        headers: {
          Allow: 'POST',
        },
      },
    );
  }

  try {
    // Extract and verify authorization token
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json(
        {
          error: 'Authorization required',
          message: 'Please provide a valid Bearer token in Authorization header',
        },
        { status: 401 },
      );
    }

    const v8AccessToken = authHeader.replace('Bearer ', '');

    /*
     * Verify token (you'll need to provide v8ApiEndpoint)
     * For now, we'll assume the token is valid and use it directly
     * const user = await verifyV8AccessToken(v8ApiEndpoint, v8AccessToken);
     */

    const body = await request.json();
    const { workdirName = 'workspace', forwardPreviewErrors = false } = body as {
      workdirName?: string;
      forwardPreviewErrors?: boolean;
    };

    // Only remotecontainer is supported
    const containerType = 'remotecontainer';

    // Configure container options
    const options: ContainerOptions = {
      workdirName,
      forwardPreviewErrors,
      v8AccessToken,
    };

    logger.info(`Creating ${containerType} container with options:`, options);

    // Create remotecontainer
    const container = await ContainerFactory.create('remotecontainer', options);

    // Return container information
    const response = {
      success: true,
      containerType,
      workdir: container.workdir,
      machineId: (container as any).machineId,
      createdAt: new Date().toISOString(),
      message: `${containerType} container created successfully`,
    };

    logger.info('Container created successfully:', response);

    return json(response, { status: 201 }); // 201 Created
  } catch (error) {
    logger.error('Container creation failed:', error);

    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
