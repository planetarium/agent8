import type { Container } from '~/lib/container/interfaces';
import { atom } from 'nanostores';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

// Create a broadcast channel for preview updates
const PREVIEW_CHANNEL = 'preview-updates';

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #container: Promise<Container>;
  #broadcastChannel: BroadcastChannel;
  #lastUpdate = new Map<string, number>();
  #refreshTimeouts = new Map<string, NodeJS.Timeout>();
  #REFRESH_DELAY = 300;

  previews = atom<PreviewInfo[]>([]);

  constructor(containerPromise: Promise<Container>) {
    this.#container = containerPromise;
    this.#broadcastChannel = new BroadcastChannel(PREVIEW_CHANNEL);

    // Listen for preview updates from other tabs
    this.#broadcastChannel.onmessage = (event) => {
      const { type, previewId } = event.data;

      if (type === 'file-change') {
        const timestamp = event.data.timestamp;
        const lastUpdate = this.#lastUpdate.get(previewId) || 0;

        if (timestamp > lastUpdate) {
          this.#lastUpdate.set(previewId, timestamp);
          this.refreshPreview(previewId);
        }
      }
    };

    this.#init();
  }

  async #init() {
    const container = await this.#container;

    // Listen for server ready events
    container.on('server-ready', (port, url) => {
      console.log('[Preview] Server ready on port:', port, url);
      this.broadcastUpdate(url);
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
          const previews = this.previews.get();

          for (const preview of previews) {
            const previewId = this.getPreviewId(preview.baseUrl);

            if (previewId) {
              this.broadcastFileChange(previewId);
            }
          }
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

      this.previews.set([previewInfo]);

      if (type === 'open') {
        this.broadcastUpdate(url);
      }
    });
  }

  // Helper to extract preview ID from URL
  getPreviewId(url: string): string | null {
    const match = url.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);
    return match ? match[1] : null;
  }

  // Broadcast state change to all tabs
  broadcastStateChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);

    this.#broadcastChannel.postMessage({
      type: 'state-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast file change to all tabs
  broadcastFileChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);

    this.#broadcastChannel.postMessage({
      type: 'file-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast update to all tabs
  broadcastUpdate(url: string) {
    const previewId = this.getPreviewId(url);

    if (previewId) {
      const timestamp = Date.now();
      this.#lastUpdate.set(previewId, timestamp);

      this.#broadcastChannel.postMessage({
        type: 'file-change',
        previewId,
        timestamp,
      });
    }
  }

  // Method to refresh a specific preview
  refreshPreview(previewId: string) {
    // Clear any pending refresh for this preview
    const existingTimeout = this.#refreshTimeouts.get(previewId);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set a new timeout for this refresh
    const timeout = setTimeout(() => {
      const previews = this.previews.get();
      const preview = previews.find((p) => this.getPreviewId(p.baseUrl) === previewId);

      if (preview) {
        preview.ready = false;
        this.previews.set([...previews]);

        requestAnimationFrame(() => {
          preview.ready = true;
          this.previews.set([...previews]);
        });
      }

      this.#refreshTimeouts.delete(previewId);
    }, this.#REFRESH_DELAY);

    this.#refreshTimeouts.set(previewId, timeout);
  }

  // 퍼블리시된 URL 설정 메서드 추가
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

    this.broadcastUpdate(url);
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
