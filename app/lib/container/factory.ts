import type { Container, ContainerOptions } from './interfaces';
import { RemoteContainerFactory } from './remote-container-impl';
import { WebContainerFactory } from './webcontainer-impl';

/**
 * Available container types
 */
export type ContainerType = 'webcontainer' | 'remotecontainer';

/**
 * Container factory class
 * Provides factory methods to create various container implementations
 */
export class ContainerFactory {
  private static _webContainerFactory = new WebContainerFactory();
  private static _remoteContainerFactory = new RemoteContainerFactory(
    'fly-summer-log-9042.fly.dev',
    'fly-summer-log-9042',
  );

  /**
   * Create a container of the specified type
   *
   * @param type Container type
   * @param options Container configuration options
   * @returns Created container instance
   */
  static async create(type: ContainerType, options: ContainerOptions): Promise<Container> {
    switch (type) {
      case 'webcontainer':
        return this._webContainerFactory.boot(options);
      case 'remotecontainer':
        return this._remoteContainerFactory.boot(options);
      default:
        throw new Error(`Unknown container type: ${type}`);
    }
  }
}
