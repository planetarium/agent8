import type { Container, ContainerOptions } from './interfaces';
import { WebContainerFactory } from './webcontainer-impl';

/**
 * Available container types
 */
export type ContainerType = 'webcontainer' | 'alternative';

/**
 * Container factory class
 * Provides factory methods to create various container implementations
 */
export class ContainerFactory {
  private static _webContainerFactory = new WebContainerFactory();

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
      case 'alternative':
        // For future alternative implementations
        throw new Error('Alternative container implementation is not yet implemented');
      default:
        throw new Error(`Unknown container type: ${type}`);
    }
  }
}
