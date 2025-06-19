import type { Container, ContainerOptions } from './interfaces';
import { RemoteContainerFactory } from './remote-container-impl';

/**
 * Container factory class
 * Simplified to only support RemoteContainer
 */
export class ContainerFactory {
  private static _remoteContainerFactory = new RemoteContainerFactory('agent8-controller.fly.dev', 'agent8-container');

  /**
   * Create a remote container instance
   * @param options Container configuration options
   * @returns Created container instance
   */
  static async create(options: ContainerOptions): Promise<Container> {
    return this._remoteContainerFactory.boot(options);
  }
}
