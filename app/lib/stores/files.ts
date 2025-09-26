import type { Container, PathWatcherEvent } from '~/lib/container/interfaces';
import { getEncoding } from 'istextorbinary';
import isBinaryPath from 'is-binary-path';
import { fileTypeFromBuffer } from 'file-type';
import { map, type MapStore } from 'nanostores';
import { Buffer } from 'node:buffer';
import { path } from '~/utils/path';
import { bufferWatchEvents } from '~/utils/buffer';
import { WORK_DIR } from '~/utils/constants';
import { computeFileModifications } from '~/utils/diff';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('FilesStore');

const utf8TextDecoder = new TextDecoder('utf-8', { fatal: true });

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  mimeType?: string;
  fileFormat?: string;
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
           * @note Enhanced binary file detection using path-based and content-based analysis.
           * This provides more accurate detection than the previous method and supports
           * a wider range of file formats including 3D models, images, and other binary formats.
           */
          const binaryDetectionResult = await detectBinaryFile(sanitizedPath, buffer);
          const isBinary = binaryDetectionResult.isBinary;

          if (!isBinary) {
            content = this.#decodeFileContent(buffer);
          }

          this.files.setKey(sanitizedPath, {
            type: 'file',
            content,
            isBinary,
            mimeType: binaryDetectionResult.mimeType,
            fileFormat: binaryDetectionResult.fileFormat,
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

/**
 * Enhanced binary file detection using is-binary-path + file-type combination
 * Provides accurate detection for various file formats including 3D models, images, etc.
 */
async function detectBinaryFile(
  filePath: string,
  buffer?: Uint8Array,
): Promise<{
  isBinary: boolean;
  mimeType?: string;
  fileFormat?: string;
  confidence: 'high' | 'medium' | 'low';
}> {
  // Step 1: Quick path-based detection using is-binary-path
  if (isBinaryPath(filePath)) {
    return {
      isBinary: true,
      confidence: 'high',
      fileFormat: getFileFormatFromPath(filePath),
    };
  }

  // Step 2: Content-based detection using file-type
  if (buffer && buffer.length > 0) {
    try {
      const fileType = await fileTypeFromBuffer(buffer.slice(0, 4100));

      if (fileType) {
        const isBinary = !fileType.mime.startsWith('text/');
        return {
          isBinary,
          mimeType: fileType.mime,
          fileFormat: fileType.ext.toUpperCase(),
          confidence: 'high',
        };
      }
    } catch (error) {
      // file-type failed, fall back to content analysis
      logger.debug('file-type detection failed:', error);
    }

    // Step 3: Content analysis as fallback
    const contentResult = analyzeFileContent(buffer);

    if (contentResult.confidence === 'high') {
      return contentResult;
    }

    // Step 4: Enhanced content analysis with istextorbinary as final fallback
    const isTextOrBinary = getEncoding(convertToBuffer(buffer), { chunkLength: 100 });

    if (isTextOrBinary === 'binary') {
      return {
        isBinary: true,
        confidence: 'medium',
      };
    }
  }

  // Default: assume text file
  return {
    isBinary: false,
    confidence: 'low',
  };
}

/**
 * Analyzes file content to determine if it's binary
 */
function analyzeFileContent(buffer: Uint8Array): {
  isBinary: boolean;
  confidence: 'high' | 'medium' | 'low';
} {
  if (buffer.length === 0) {
    return { isBinary: false, confidence: 'high' };
  }

  const sampleSize = Math.min(8000, buffer.length);
  let nullBytes = 0;
  let highBytes = 0;
  let controlChars = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];

    if (byte === 0) {
      nullBytes++;
    } else if (byte > 127) {
      highBytes++;
    } else if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlChars++;
    }
  }

  // Presence of null bytes is a strong indicator of binary content
  if (nullBytes > 0) {
    return { isBinary: true, confidence: 'high' };
  }

  // High ratio of control characters or high bytes suggests binary
  const suspiciousRatio = (controlChars + highBytes) / sampleSize;

  if (suspiciousRatio > 0.3) {
    return { isBinary: true, confidence: 'high' };
  } else if (suspiciousRatio > 0.1) {
    return { isBinary: true, confidence: 'medium' };
  }

  return { isBinary: false, confidence: 'medium' };
}

/**
 * Extracts file format from file path
 */
function getFileFormatFromPath(filePath: string): string {
  const extension = filePath.toLowerCase().split('.').pop();

  if (!extension) {
    return 'UNKNOWN';
  }

  // Map common extensions to readable formats
  const formatMap: Record<string, string> = {
    // Images
    png: 'PNG',
    jpg: 'JPEG',
    jpeg: 'JPEG',
    gif: 'GIF',
    webp: 'WebP',
    svg: 'SVG',
    bmp: 'BMP',
    tiff: 'TIFF',
    ico: 'ICO',

    // 3D Models
    glb: 'GLB',
    gltf: 'glTF',
    obj: 'OBJ',
    fbx: 'FBX',
    dae: 'Collada',
    stl: 'STL',
    '3ds': '3DS',
    blend: 'Blender',
    max: '3ds Max',

    // Documents
    pdf: 'PDF',
    doc: 'Word',
    docx: 'Word',
    xls: 'Excel',
    xlsx: 'Excel',
    ppt: 'PowerPoint',
    pptx: 'PowerPoint',

    // Archives
    zip: 'ZIP',
    rar: 'RAR',
    '7z': '7-Zip',
    tar: 'TAR',
    gz: 'GZIP',

    // Executables
    exe: 'Executable',
    dll: 'DLL',
    so: 'Shared Library',
    dylib: 'Dynamic Library',

    // Audio/Video
    mp3: 'MP3',
    wav: 'WAV',
    mp4: 'MP4',
    avi: 'AVI',
    mov: 'QuickTime',
    mkv: 'MKV',
    flac: 'FLAC',
    ogg: 'OGG',
  };

  return formatMap[extension] || extension.toUpperCase();
}

/**
 * Converts a `Uint8Array` into a Node.js `Buffer` by copying the prototype.
 * The goal is to  avoid expensive copies. It does create a new typed array
 * but that's generally cheap as long as it uses the same underlying
 * array buffer.
 */
function convertToBuffer(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}
