import type { Container, ContainerFactory, ContainerOptions } from './interfaces';
import { createScopedLogger } from '~/utils/logger';
import { RemoteContainer } from './remote-container';

const ROUTER_DOMAIN = 'agent8.verse8.net';
const logger = createScopedLogger('remote-container');

/**
 * Remote container factory
 */
export class RemoteContainerFactory implements ContainerFactory {
  constructor(
    private _serverUrl: string,
    private _appName: string,
  ) {}

  async boot(options: ContainerOptions): Promise<Container> {
    try {
      // For webcontainer compatibility
      const workdir = `/home/${options.workdirName}`;
      const v8AccessToken = options.v8AccessToken;

      if (!v8AccessToken) {
        throw new Error('No V8 access token given');
      }

      // Request machineId with retry logic
      const machineId = await this._requestMachineId(v8AccessToken);

      logger.info('Waiting for machine to be ready...');
      await this._waitForMachineReady(machineId, v8AccessToken);
      logger.info('Machine is ready');

      // Create remote container instance
      const container = new RemoteContainer(
        `wss://${this._appName}-${machineId}.${ROUTER_DOMAIN}`,
        workdir,
        v8AccessToken,
      );

      // Initialize connection
      try {
        await container.connect();
        logger.info('Successfully connected to remote container');

        return container;
      } catch (error) {
        throw new Error(`Failed to connect to remote container: ${error}`);
      }
    } catch (error) {
      logger.error('Failed to boot remote container:', error);
      throw error;
    }
  }

  /**
   * Request a machine ID from the API with retry logic
   * @param token - The authentication token
   * @returns The machine ID
   */
  private async _requestMachineId(token: string): Promise<string> {
    try {
      const response = await fetch(`https://${this._serverUrl}/api/machine`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          logger.error('Unauthorized access, reloading page...');
          window.parent.postMessage(
            {
              type: 'AUTH_REFRESH_REQUIRED',
              payload: {
                message: 'Authentication failed after multiple attempts. Please refresh the page.',
                errorCode: 401,
                source: 'remote-container',
              },
            },
            '*',
          );
          throw new Error('Unauthorized access, reloading page');
        }

        throw new Error(`API response error: ${response.status}`);
      }

      const machineId = ((await response.json()) as { machine_id?: string }).machine_id;

      if (machineId === undefined) {
        throw new Error('No machine ID received from server');
      }

      return machineId;
    } catch (error) {
      throw new Error(`Machine API request failed: ${error}`);
    }
  }

  private async _waitForMachineReady(machineId: string, token: string): Promise<void> {
    const maxRetries = 30; // Maximum 30 attempts
    const delayMs = 2000; // Check every 2 seconds

    interface MachineResponse {
      success: boolean;
      machine?: {
        id: string;
        state: string;
        [key: string]: any;
      };
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`https://${this._serverUrl}/api/machine/${machineId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`API response error: ${response.status}`);
        }

        const data = (await response.json()) as MachineResponse;

        if (data.success && data.machine && data.machine.state === 'started') {
          return; // Machine is ready
        }

        logger.info(`Machine state: ${data.machine?.state || 'unknown'}, retrying...`);
      } catch (error) {
        logger.error(`Error checking machine status: ${error}`);
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Machine not ready. Maximum retry count exceeded');
  }
}
