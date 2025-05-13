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
let containerResolver: (container: Container | null) => void;
export let container: Promise<Container> = new Promise((resolve) => {
  containerResolver = resolve as (container: Container | null) => void;
});

export const containerType = import.meta.env.VITE_CONTAINER_TYPE || 'remotecontainer';

/**
 * Initialize the container with the provided access token
 * This allows delayed initialization after authentication
 *
 * @param accessToken V8 access token for authentication
 * @param forceReinitialization If true, forces creation of a new container even if one exists
 * @returns Promise resolving to the container instance
 */
export function initializeContainer(
  accessToken?: string | null,
  forceReinitialization = false,
): Promise<Container | null> {
  logger.info('Initializing container...', {
    containerType,
    hasToken: !!accessToken,
    isSSR: import.meta.env.SSR,
    forceReinitialization,
  });

  if (import.meta.env.SSR) {
    logger.info('Skipping initialization in SSR');
    return new Promise(() => {
      // noop for SSR
    });
  }

  // Skip HMR data check if forced reinitialization
  if (!forceReinitialization && import.meta.hot?.data.container) {
    container = import.meta.hot.data.container;
    return container;
  }

  // Reset HMR data if forcing reinitialization
  if (forceReinitialization && import.meta.hot) {
    import.meta.hot.data.container = null;
  }

  const containerPromise = Promise.resolve()
    .then(() => {
      logger.info('Creating container instance...');
      return ContainerFactory.create(containerType, {
        coep: 'credentialless',
        workdirName: WORK_DIR_NAME,
        forwardPreviewErrors: true,
        v8AccessToken: accessToken || undefined,
      });
    })
    .then(async (containerInstance) => {
      logger.info('Container instance created successfully');
      containerContext.loaded = true;

      const { workbenchStore } = await import('~/lib/stores/workbench');

      // Handle preview errors
      containerInstance.on('preview-message', (message) => {
        logger.info('Preview message:', message);

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
    .catch(async (error) => {
      const errorMsg = forceReinitialization ? 'Container reinitialization failed' : 'Container initialization failed';
      logger.error(`${errorMsg}:`, error);

      try {
        // Use toast notification for immediate visual feedback
        const { toast } = await import('react-toastify');
        toast.error(`${errorMsg}: ` + (error instanceof Error ? error.message : String(error)), {
          position: 'top-center',
          autoClose: 8000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
        });

        // Log to central error store for persistence
        const { logStore } = await import('~/lib/stores/logs');
        logStore.logError(errorMsg, error, {
          componentType: containerType,
          hasAccessToken: !!accessToken,
        });
      } catch (logError) {
        // Fallback logging if imports fail
        console.error(`Failed to show container error notification:`, logError);
      }

      return null;
    });

  // Resolve the original container promise
  containerPromise.then(containerResolver);

  if (import.meta.hot) {
    import.meta.hot.data.container = containerPromise;
  }

  return containerPromise;
}

/*
 * Container initialization is now delayed until access token is available
 * The container should be initialized by calling initializeContainer with the access token
 * This is typically done after user authentication or when the token is retrieved
 */
if (!import.meta.env.SSR && import.meta.hot?.data.container) {
  container = import.meta.hot.data.container;
}
