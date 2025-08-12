import type { Container } from '~/lib/container/interfaces';
import { atom } from 'nanostores';
import { playCompletionSound } from '~/utils/sound';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #container: Promise<Container>;

  previews = atom<PreviewInfo[]>([]);

  constructor(containerPromise: Promise<Container>) {
    this.#container = containerPromise;
    this.#init();
  }

  async #init() {
    const container = await this.#container;

    // Listen for server ready events
    container.on('server-ready', (port, url) => {
      console.log('[Preview] Server ready on port:', port, url);
    });

    try {
      container.fs.watchPaths(
        {
          include: ['**/*'],
          exclude: ['**/node_modules'],
          ignoreInitial: true,
          includeContent: false,
        },
        async () => {
          console.log('[Preview] Files changed, manual refresh available');
        },
      );
    } catch (error) {
      console.error('[Preview] Error setting up watchers:', error);
    }

    // Listen for port events
    container.on('port', (port: number, type: string, url: string) => {
      console.log('[Preview] Port event received:', port, type, url);

      let previewInfo = this.#availablePreviews.get(port);

      if (type === 'close' && previewInfo) {
        this.#availablePreviews.delete(port);
        this.previews.set(this.previews.get().filter((preview) => preview.port !== port));

        return;
      }

      if (!previewInfo) {
        previewInfo = { port, ready: type === 'open', baseUrl: url };
        this.#availablePreviews.set(port, previewInfo);
      }

      previewInfo.ready = type === 'open';
      previewInfo.baseUrl = url;

      // Play completion sound when preview is ready
      if (type === 'open') {
        playCompletionSound();
      }

      this.previews.set([previewInfo]);
    });
  }

  // 퍼블리시된 URL 설정 메서드
  setPublishedUrl(url: string) {
    const port = 80;
    let previewInfo = this.#availablePreviews.get(port);

    if (!previewInfo) {
      previewInfo = { port, ready: true, baseUrl: url };
      this.#availablePreviews.set(port, previewInfo);
    }

    previewInfo.baseUrl = url;
    previewInfo.ready = true;

    this.previews.set([previewInfo]);
  }
}

// Create a singleton instance
let previewsStore: PreviewsStore | null = null;

export function usePreviewStore() {
  if (!previewsStore) {
    /*
     * Initialize with a Promise that resolves to Container
     * This should match how you're initializing Container elsewhere
     */
    previewsStore = new PreviewsStore(Promise.resolve({} as Container));
  }

  return previewsStore;
}
