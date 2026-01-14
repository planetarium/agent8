import type { Container, ContainerFactory, ContainerOptions } from './interfaces';
import { createScopedLogger } from '~/utils/logger';
import { RemoteContainer } from './remote-container';
import { MachineAPIError } from '~/utils/errors';

const ROUTER_DOMAIN = 'agent8.verse8.net';
const logger = createScopedLogger('remote-container');

class MachineDestroyedException extends Error {
  constructor(machineId: string) {
    super(`Machine ${machineId} is destroyed`);
    this.name = 'MachineDestroyedException';
  }
}

export class RemoteContainerFactory implements ContainerFactory {
  constructor(
    private _serverUrl: string,
    private _appName: string,
  ) {}

  async boot(options: ContainerOptions): Promise<Container> {
    const maxMachineRetries = 3;

    for (let machineAttempt = 0; machineAttempt < maxMachineRetries; machineAttempt++) {
      try {
        const workdir = `/home/${options.workdirName}`;
        const v8AccessToken = options.v8AccessToken;

        if (!v8AccessToken) {
          throw new Error('No V8 access token given');
        }

        const machineId = await this._requestMachineId(v8AccessToken);

        logger.info('Waiting for machine to be ready...');
        await this._waitForMachineReady(machineId, v8AccessToken);
        logger.info('Machine is ready');

        const container = new RemoteContainer(
          `wss://${this._appName}-${machineId}.${ROUTER_DOMAIN}`,
          workdir,
          v8AccessToken,
        );

        try {
          await container.connect();
          logger.info('Successfully connected to remote container');

          return container;
        } catch (error) {
          throw new Error(`Failed to connect to remote container: ${error}`);
        }
      } catch (error) {
        if (error instanceof MachineDestroyedException) {
          logger.warn(`Machine destroyed, requesting new machine (attempt ${machineAttempt + 1}/${maxMachineRetries})`);

          if (machineAttempt < maxMachineRetries - 1) {
            continue;
          }
        }

        logger.error('Failed to boot remote container:', error);
        throw error;
      }
    }

    throw new Error('Failed to boot remote container after all machine retry attempts');
  }

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
          throw new MachineAPIError('Unauthorized access, reloading page', response.status);
        }

        throw new MachineAPIError(`API response error: ${response.status}`, response.status);
      }

      const machineId = ((await response.json()) as { machine_id?: string }).machine_id;

      if (machineId === undefined) {
        throw new Error('No machine ID received from server');
      }

      return machineId;
    } catch (error) {
      const prefixMessage = 'Machine API request failed';

      if (error instanceof MachineAPIError) {
        throw new MachineAPIError(`${prefixMessage}: ${error.message}`, error.status);
      } else {
        throw new Error(`${prefixMessage}: ${error}`);
      }
    }
  }

  private async _waitForMachineReady(machineId: string, token: string): Promise<void> {
    const maxRetries = 30;
    const delayMs = 2000;

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

        if (data.success && data.machine) {
          const machineState = data.machine.state;

          if (machineState === 'started') {
            return;
          }

          if (machineState === 'destroyed') {
            logger.warn(`Machine ${machineId} is destroyed, need to request new machine`);
            throw new MachineDestroyedException(machineId);
          }
        }

        logger.info(`Machine state: ${data.machine?.state || 'unknown'}, retrying...`);
      } catch (error) {
        if (error instanceof MachineDestroyedException) {
          throw error;
        }

        logger.error(`Error checking machine status: ${error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Machine not ready. Maximum retry count exceeded');
  }
}
