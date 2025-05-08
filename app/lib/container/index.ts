import type { Container, ContainerContext } from './interfaces';
import { ContainerFactory } from './factory';
import { WORK_DIR_NAME } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { cleanStackTrace } from '~/utils/stacktrace';

const logger = createScopedLogger('container');

/**
 * Container context - maintains state for hot module reloading
 */
export const containerContext: ContainerContext = import.meta.hot?.data.containerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.containerContext = containerContext;
}

/**
 * Container promise instance
 * Will not execute in SSR
 */
export let container: Promise<Container> = new Promise(() => {
  // noop for SSR
});

export const containerType = import.meta.env.VITE_CONTAINER_TYPE || 'remotecontainer';

if (!import.meta.env.SSR) {
  container =
    import.meta.hot?.data.container ??
    Promise.resolve()
      .then(() => {
        return ContainerFactory.create(containerType, {
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true,
          v8AccessToken: localStorage.getItem('v8AccessToken') || undefined,
        });
      })
      .then(async (containerInstance) => {
        containerContext.loaded = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        // Handle preview errors
        containerInstance.on('preview-message', (message) => {
          console.log('Container preview message:', message);

          // Handle uncaught exceptions and promise rejections
          if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
            const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
            workbenchStore.actionAlert.set({
              type: 'preview',
              title: isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception',
              description: message.message || 'An error occurred in the preview',
              content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
              source: 'preview',
            });
          }
        });

        return containerInstance;
      })
      .catch((error) => {
        logger.error('Container initialization failed:', error);
        return null;
      });

  if (import.meta.hot) {
    import.meta.hot.data.container = container;
  }
}
