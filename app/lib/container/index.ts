import type { Container, ContainerContext } from './interfaces';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('container');

// ✅ 호환성 레이어: 기존 코드 보호를 위한 전역 API 유지
let workbenchStore: any = null;

// 지연 로딩으로 순환 참조 방지
async function getWorkbenchStore() {
  if (!workbenchStore) {
    const { workbenchStore: store } = await import('~/lib/stores/workbench');
    workbenchStore = store;
  }

  return workbenchStore;
}

// ✅ 호환성 레이어: 전역 containerContext (deprecated)
export const containerContext: ContainerContext = import.meta.hot?.data.containerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.containerContext = containerContext;
}

// ✅ 호환성 레이어: 전역 container (deprecated) - 기존 동작 재현
let containerResolver: (container: Container | null) => void;
export const container: Promise<Container> = new Promise((resolve) => {
  containerResolver = resolve as (container: Container | null) => void;
});

// ✅ 호환성 레이어: initializeContainer 함수 (deprecated)
export async function initializeContainer(
  accessToken?: string | null,
  forceReinitialization = false,
): Promise<Container | null> {
  logger.warn('initializeContainer() is deprecated. Consider using WorkbenchStore.initializeContainer() directly.');

  if (!accessToken) {
    containerResolver(null);

    return Promise.resolve(null);
  }

  if (import.meta.env.SSR) {
    logger.info('Skipping initialization in SSR');
    containerResolver(null);

    return Promise.resolve(null);
  }

  try {
    const store = await getWorkbenchStore();

    let result: Container | null;

    if (forceReinitialization) {
      result = await store.reinitializeContainer(accessToken);
    } else {
      result = await store.initializeContainer(accessToken);
    }

    if (result) {
      containerContext.loaded = true;
      containerResolver(result);
    } else {
      containerResolver(null);
    }

    return result;
  } catch (error) {
    logger.error('Container initialization failed:', error);

    try {
      const { toast } = await import('react-toastify');
      toast.error('Container initialization failed: ' + (error instanceof Error ? error.message : String(error)), {
        position: 'top-center',
        autoClose: 8000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
    } catch (toastError) {
      console.error('Failed to show container error notification:', toastError);
    }

    containerResolver(null);

    return null;
  }
}

// HMR 지원 (기존 코드 유지)
if (!import.meta.env.SSR && import.meta.hot?.data.container) {
  // HMR 데이터가 있으면 WorkbenchStore에 전달
  getWorkbenchStore().then((store) => {
    if (import.meta.hot?.data.container) {
      store.setHMRContainer(import.meta.hot.data.container);

      import.meta.hot.data.container.then((containerInstance: Container) => {
        containerContext.loaded = true;
        containerResolver(containerInstance);
      });
    }
  });
}
