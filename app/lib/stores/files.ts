import type { Container, PathWatcherEvent } from '~/lib/container/interfaces';
import { map, type MapStore } from 'nanostores';
import { path } from '~/utils/path';
import { bufferWatchEvents } from '~/utils/buffer';
import { WORK_DIR } from '~/utils/constants';
import { computeFileModifications } from '~/utils/diff';
import { createScopedLogger } from '~/utils/logger';
import { detectBinaryFile } from '~/utils/fileUtils';

const logger = createScopedLogger('FilesStore');

const utf8TextDecoder = new TextDecoder('utf-8', { fatal: true });

export interface File {
  type: 'file';

  /**
   * 파일의 텍스트 내용
   * - 텍스트 파일: 실제 파일 내용 (UTF-8 문자열)
   * - 바이너리 파일: 빈 문자열 '' (기존 코드 호환성 유지)
   */
  content: string;

  /**
   * 바이너리 파일 여부를 나타내는 플래그
   * true: 바이너리 파일 (이미지, 실행파일 등)
   * false: 텍스트 파일 (코드, 문서 등)
   */
  isBinary: boolean;
  mimeType?: string;
  fileFormat?: string;

  /**
   * 바이너리 파일의 원본 데이터
   * - 바이너리 파일: 실제 Uint8Array 데이터
   * - 텍스트 파일: undefined
   *
   * 설계 이유: content 필드를 string | Uint8Array로 변경하지 않고
   * 별도 buffer 필드를 추가하여 기존 코드의 변경을 최소화
   */
  buffer?: Uint8Array;
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export class FilesStore {
  #container: Promise<Container>;

  /**
   * Tracks the number of files without folders.
   */
  #size = 0;

  /**
   * @note Keeps track all modified files with their original content since the last user message.
   * Needs to be reset when the user sends another message and all changes have to be submitted
   * for the model to be aware of the changes.
   */
  #modifiedFiles: Map<string, string> = import.meta.hot?.data.modifiedFiles ?? new Map();

  /**
   * Map of files that matches the state of Container.
   */
  files: MapStore<FileMap> = import.meta.hot?.data.files ?? map({});

  get filesCount() {
    return this.#size;
  }

  constructor(containerPromise: Promise<Container>) {
    this.#container = containerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.files = this.files;
      import.meta.hot.data.modifiedFiles = this.#modifiedFiles;
    }

    this.#init();
  }

  getFile(filePath: string) {
    const dirent = this.files.get()[filePath];

    if (dirent?.type !== 'file') {
      return undefined;
    }

    return dirent;
  }

  getFileModifications() {
    return computeFileModifications(this.files.get(), this.#modifiedFiles);
  }
  getModifiedFiles() {
    let modifiedFiles: { [path: string]: File } | undefined = undefined;

    for (const [filePath, originalContent] of this.#modifiedFiles) {
      const file = this.files.get()[filePath];

      if (file?.type !== 'file') {
        continue;
      }

      if (file.content === originalContent) {
        continue;
      }

      if (!modifiedFiles) {
        modifiedFiles = {};
      }

      modifiedFiles[filePath] = file;
    }

    return modifiedFiles;
  }

  resetFileModifications() {
    this.#modifiedFiles.clear();
  }

  async saveFile(filePath: string, content: string) {
    const container = await this.#container;

    try {
      const relativePath = path.relative(container.workdir, filePath);

      if (!relativePath) {
        throw new Error(`EINVAL: invalid file path, write '${relativePath}'`);
      }

      const oldContent = this.getFile(filePath)?.content;

      await container.fs.writeFile(relativePath, content);

      if (!this.#modifiedFiles.has(filePath)) {
        this.#modifiedFiles.set(filePath, oldContent ?? '');
      }

      // we immediately update the file and don't rely on the `change` event coming from the watcher
      this.files.setKey(filePath, {
        type: 'file',
        content,
        isBinary: false,
      });

      logger.info('File updated');
    } catch (error) {
      logger.error('Failed to update file content\n\n', error);

      throw error;
    }
  }

  async #init() {
    const container = await this.#container;

    // @ts-ignore TODO: remove ts-ignore after merge watchPaths
    container.fs.watchPaths(
      {
        include: [`${WORK_DIR}/**`],
        exclude: ['**/node_modules', '.git'],
        includeContent: true,
        ignoreInitial: false,
      },
      bufferWatchEvents(100, async (events) => await this.#processEventBuffer(events)),
    );
  }

  async #processEventBuffer(events: Array<[events: PathWatcherEvent[]]>) {
    const watchEvents = events.flat(2);

    for (const { type, path, buffer } of watchEvents) {
      // remove any trailing slashes
      const sanitizedPath = path.replace(/\/+$/g, '');

      switch (type) {
        case 'add_dir': {
          // we intentionally add a trailing slash so we can distinguish files from folders in the file tree
          this.files.setKey(sanitizedPath, { type: 'folder' });
          break;
        }
        case 'remove_dir': {
          this.files.setKey(sanitizedPath, undefined);

          for (const [direntPath] of Object.entries(this.files)) {
            if (direntPath.startsWith(sanitizedPath)) {
              this.files.setKey(direntPath, undefined);
            }
          }

          break;
        }
        case 'add_file':
        case 'change': {
          if (type === 'add_file') {
            this.#size++;
          }

          let content = '';

          /**
           * @note Enhanced binary file detection using unified utility function
           */
          const binaryDetectionResult = await detectBinaryFile(sanitizedPath, buffer);
          const isBinary = binaryDetectionResult.isBinary;

          /**
           * 파일 타입별 데이터 저장:
           * - 바이너리 파일: buffer에 원본 Uint8Array 저장, content는 빈 문자열
           * - 텍스트 파일: content에 UTF-8 문자열 저장, buffer는 undefined
           *
           * content 필드를 string | Uint8Array로 변경하지 않고 별도 buffer 필드를 추가한 이유:
           * 기존 코드에서 content를 string으로 사용하는 부분의 변경을 최소화
           */
          if (!isBinary) {
            // 텍스트 파일: 문자열로 디코딩하여 content에 저장
            content = this.#decodeFileContent(buffer);
          }

          // 바이너리 파일: content는 빈 문자열로 유지, buffer에 원본 데이터 보존

          this.files.setKey(sanitizedPath, {
            type: 'file',
            content, // 바이너리: '', 텍스트: 실제 내용
            isBinary,
            mimeType: binaryDetectionResult.mimeType,
            fileFormat: binaryDetectionResult.fileFormat,
            buffer: isBinary ? buffer : undefined, // 바이너리: 실제 데이터, 텍스트: undefined
          });

          break;
        }
        case 'remove_file': {
          this.#size--;
          this.files.setKey(sanitizedPath, undefined);
          break;
        }
        case 'update_directory': {
          // we don't care about these events
          break;
        }
      }
    }
  }

  #decodeFileContent(buffer?: Uint8Array) {
    if (!buffer || buffer.byteLength === 0) {
      return '';
    }

    try {
      return utf8TextDecoder.decode(buffer);
    } catch (error) {
      console.error('Failed to decode file content\n\n', error);
      return '';
    }
  }
}
