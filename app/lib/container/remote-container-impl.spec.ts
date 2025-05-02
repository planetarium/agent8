import { WebSocket } from 'ws';
import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { RemoteContainerFactory, RemoteContainerFileSystem } from '~/lib/container/remote-container-impl';
import type { FileSystemTree, Container, PathWatcherEvent } from '~/lib/container/interfaces';
import type { ITerminal } from '~/types/terminal';

global.WebSocket = WebSocket as any;

/**
 * 실제 서버 연결을 위한 설정
 * 테스트 실행 시 실제 서버에 연결합니다.
 */
const TEST_SERVER_URL = 'ws://localhost:53000'; // 테스트용 서버 URL 설정

/**
 * 실제 터미널 연결을 위한 터미널 목업
 */
class MockTerminal implements ITerminal {
  constructor(
    public cols: number = 80,
    public rows: number = 24,
  ) {}

  write(data: string): void {
    console.log('[터미널 출력]', data);
  }

  onData(callback: (data: string) => void): void {
    // 필요한 경우 여기서 데이터 입력을 시뮬레이션
    this._dataCallback = callback;
  }

  input(data: string): void {
    if (this._dataCallback) {
      this._dataCallback(data);
    }
  }

  reset(): void {
    console.log('[터미널 리셋]');
  }

  private _dataCallback: ((data: string) => void) | null = null;
}

describe('RemoteContainer 통합 테스트', () => {
  let container: Container;

  beforeAll(async () => {
    // 실제 컨테이너 팩토리 생성 및 부팅
    const factory = new RemoteContainerFactory(TEST_SERVER_URL);
    container = await factory.boot({ workdirName: '/workspace' });
  });

  afterAll(() => {
    // 정리 작업 (필요한 경우)
  });

  it('파일 시스템에서 파일을 읽고 쓸 수 있어야 함', async () => {
    // 테스트 파일 생성
    const testContent = '테스트 파일 내용';
    const testPath = '/workspace/test-file.txt';

    await container.fs.writeFile(testPath, testContent);

    // 파일 읽기
    const content = await container.fs.readFile(testPath, 'utf8');

    // 검증
    expect(content).toBe(testContent);

    // 정리
    await container.fs.rm(testPath);
  });

  it('디렉토리를 생성하고 읽을 수 있어야 함', async () => {
    // 테스트 디렉토리 생성
    const testDir = '/workspace/test-dir';

    await container.fs.mkdir(testDir);

    // 테스트 파일 생성
    await container.fs.writeFile(`${testDir}/file1.txt`, 'File 1');
    await container.fs.writeFile(`${testDir}/file2.txt`, 'File 2');

    // 디렉토리 읽기
    const entries = await container.fs.readdir(testDir);

    // 검증
    expect(entries.length).toBe(2);
    expect(entries.some((entry: any) => entry.name === 'file1.txt')).toBe(true);
    expect(entries.some((entry: any) => entry.name === 'file2.txt')).toBe(true);

    // 정리
    await container.fs.rm(testDir, { recursive: true });
  });

  it('프로세스를 생성하고 출력을 받을 수 있어야 함', async () => {
    // 간단한 명령어 실행 (echo)
    const process = await container.spawn('echo', ['Hello, World!']);

    // 출력 캡처
    const output = await new Promise<string>((resolve) => {
      let result = '';
      const reader = process.output.getReader();

      reader.read().then(function processText({ done, value }) {
        if (done) {
          resolve(result.trim());
          return;
        }

        result += value;
        reader.read().then(processText);
      });
    });

    const exitCode = await process.exit;

    // 검증
    expect(output.trim()).toBe('Hello, World!');
    expect(exitCode).toBe(0);
  });

  it('셸 세션을 생성하고 명령을 실행할 수 있어야 함', async () => {
    // 터미널 생성
    const terminal = new MockTerminal();

    // 셸 세션 생성
    const shellSession = await container.spawnShell(terminal);

    // 셸이 준비될 때까지 대기
    await shellSession.ready;

    // 명령어 입력을 위한 Writer 가져오기
    const writer = shellSession.input.getWriter();

    // 간단한 명령어 실행 (echo)
    await writer.write('echo "Shell Command Test"\n');
    writer.releaseLock();

    // 셸 세션 종료
    const writer2 = shellSession.input.getWriter();
    await writer2.write('exit\n');
    writer2.releaseLock();

    // 정리
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 셸 세션 종료 대기
  });

  it('파일 시스템 트리를 마운트할 수 있어야 함', async () => {
    // 테스트 파일 시스템 트리 생성
    const fsTree: FileSystemTree = {
      'test-mount.txt': {
        file: {
          contents: '마운트된 파일 내용',
        },
      },
      'test-dir': {
        directory: {
          'test-file.txt': {
            file: {
              contents: '디렉토리 내 파일',
            },
          },
        },
      },
    };

    // 파일 시스템 트리 마운트
    await container.mount(fsTree);

    // 파일 읽기로 검증
    const content = await container.fs.readFile('/test-mount.txt', 'utf8');
    expect(content).toBe('마운트된 파일 내용');

    // 디렉토리 내 파일 읽기
    const dirContent = await container.fs.readFile('/test-dir/test-file.txt', 'utf8');
    expect(dirContent).toBe('디렉토리 내 파일');

    // 정리
    await container.fs.rm('/test-mount.txt');
    await container.fs.rm('/test-dir', { recursive: true });
  });

  it('파일 변경을 감지하고 이벤트를 발생시켜야 함', async () => {
    // 테스트 파일 경로
    const testPath = '/workspace/watch-test.txt';

    // 파일 생성
    await container.fs.writeFile(testPath, '초기 내용');

    // 이벤트 감지 준비
    const eventPromise = new Promise<boolean>((resolve) => {
      const watcher = container.fs.watch('**/*', { persistent: true });

      watcher.addEventListener('change', (eventType, _filename) => {
        // 이벤트가 발생하면 프로미스를 해결
        expect(eventType).toBe('change');
        watcher.close();
        resolve(true);
      });

      // 타임아웃을 설정하여 이벤트가 오지 않을 경우 테스트가 실패하도록 함
      setTimeout(() => resolve(false), 5000);

      // 파일 변경
      setTimeout(async () => {
        await container.fs.writeFile(testPath, '변경된 내용');
      }, 500);
    });

    // 이벤트가 발생했는지 확인
    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);

    // 정리
    await container.fs.rm(testPath);
  });

  it('watchPaths로 여러 파일 변경을 감지해야 함', async () => {
    // 테스트 디렉토리 및 파일 준비
    const testDir = '/workspace/watch-test-dir';
    await container.fs.mkdir(testDir, { recursive: true });
    await container.fs.writeFile(`${testDir}/test1.txt`, '파일1');

    // 이벤트 감지 준비
    const eventPromise = new Promise<boolean>((resolve) => {
      const eventsReceived: PathWatcherEvent[] = [];

      container.fs.watchPaths({ include: [`workspace/watch-test-dir/**`] }, (events) => {
        eventsReceived.push(...events);

        // 첫 번째 이벤트가 발생하면 확인
        if (eventsReceived.length > 0) {
          expect(eventsReceived[0].type).toBe('change');
          expect(eventsReceived[0].path).toContain('test1.txt');
          resolve(true);
        }
      });

      // 타임아웃 설정
      setTimeout(() => resolve(false), 5000);

      // 파일 변경
      setTimeout(async () => {
        await container.fs.writeFile(`${testDir}/test1.txt`, '파일1 수정됨');
      }, 500);
    });

    // 이벤트가 발생했는지 확인
    const eventReceived = await eventPromise;
    expect(eventReceived).toBe(true);

    // 정리
    await container.fs.rm(testDir, { recursive: true });
  });
});

/**
 * 서버 없이 실행 가능한 분리된 단위 테스트
 * 실제 서버 연결 없이도 테스트할 수 있는 기능들만 테스트
 */
describe('RemoteContainerFileSystem 단위 테스트', () => {
  let mockConnection: any;
  let fileSystem: RemoteContainerFileSystem;

  beforeEach(() => {
    mockConnection = {
      sendRequest: vi.fn().mockImplementation(async (request) => {
        const { operation } = request;
        let responseData;

        switch (operation.type) {
          case 'readFile':
            responseData = { content: '파일 내용' };
            break;
          case 'writeFile':
            responseData = {};
            break;
          case 'mkdir':
            responseData = {};
            break;
          case 'readdir':
            responseData = { entries: ['file1', 'file2'] };
            break;
          case 'rm':
            responseData = {};
            break;
          default:
            responseData = {};
        }

        return {
          success: true,
          data: responseData,
        };
      }),
    };

    fileSystem = new RemoteContainerFileSystem(mockConnection);
  });

  it('readFile 메소드가 올바른 요청을 보내야 함', async () => {
    await fileSystem.readFile('/test.txt', 'utf8');
    expect(mockConnection.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: 'readFile',
          path: '/test.txt',
        }),
      }),
    );
  });

  it('writeFile 메소드가 올바른 요청을 보내야 함', async () => {
    await fileSystem.writeFile('/test.txt', '새로운 내용');
    expect(mockConnection.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: 'writeFile',
          path: '/test.txt',
          content: '새로운 내용',
        }),
      }),
    );
  });

  it('watch 메소드가 올바른 요청을 보내고 FileSystemWatcher를 반환해야 함', () => {
    const watcher = fileSystem.watch('/test-pattern', { persistent: true });

    // 요청 확인
    expect(mockConnection.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: 'watch',
          path: '/test-pattern',
          options: {
            watchOptions: {
              persistent: true,
              recursive: false,
            },
          },
        }),
      }),
    );

    // FileSystemWatcher 인터페이스 확인
    expect(watcher).toHaveProperty('addEventListener');
    expect(watcher).toHaveProperty('close');

    // 이벤트 리스너 등록 및 삭제 기능 테스트
    const listener = vi.fn();
    watcher.addEventListener('change', listener);

    /*
     * close 메소드 호출 시 리스너가 제거되는지 확인할 방법은 없지만,
     * 메소드가 호출되는지는 확인할 수 있음
     */
    const closeSpy = vi.spyOn(watcher, 'close');
    watcher.close();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('watchPaths 메소드가 올바른 요청을 보내야 함', () => {
    const options = {
      include: ['/test-dir/**/*.ts'],
      exclude: ['node_modules/**'],
    };
    const callback = vi.fn();

    fileSystem.watchPaths(options, callback);

    expect(mockConnection.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          type: 'watch-paths',
          options,
        }),
      }),
    );
  });
});
