import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RemoteContainer } from '~/lib/container/remote-container-impl';
import type { FileSystemTree, PathWatcherEvent } from '~/lib/container/interfaces';
import type { ITerminal } from '~/types/terminal';

global.WebSocket = WebSocket as any;

/**
 * 실제 서버 연결을 위한 설정
 * 테스트 실행 시 실제 서버에 연결합니다.
 */
const TEST_SERVER_URL = 'wss://fly-summer-log-9042-08016e2f09d2d8.agent8.verse8.net/'; // 테스트용 서버 URL 설정
const TEST_V8_ACCESS_TOKEN = '<v8-access-token>';
const TEST_WORKDIR = '/workspace';

/**
 * 실제 터미널 연결을 위한 터미널 목업
 */
class MockTerminal implements ITerminal {
  outputData: string = '';

  constructor(
    public cols: number = 80,
    public rows: number = 24,
  ) {}

  write(data: string): void {
    this.outputData += data;
  }

  onData(callback: (data: string) => void): void {
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

/**
 * 터미널에 문자열을 한 글자씩 입력하는 시뮬레이션 함수
 */
async function simulateTyping(terminal: MockTerminal, text: string, delayMs = 100) {
  for (const char of text) {
    terminal.input(char);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

describe('RemoteContainer 통합 테스트', () => {
  let container: RemoteContainer;

  beforeEach(async () => {
    container = new RemoteContainer(TEST_SERVER_URL, TEST_WORKDIR, TEST_V8_ACCESS_TOKEN);
  });

  afterEach(() => {
    container.close();
  });

  it('파일 시스템에서 파일을 읽고 쓸 수 있어야 함', async () => {
    // 테스트 파일 생성
    const testContent = '테스트 파일 내용';
    const testPath = 'test-file.txt';

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
    const testDir = 'test-dir';

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
    const shellSession = await container.spawnShell(terminal, { splitOutput: true });

    // 셸이 준비될 때까지 대기
    await shellSession.ready;

    // 명령어를 한 글자씩 입력
    await simulateTyping(terminal, 'echo "Hello, World!"\n');

    // 출력이 나타날 때까지 짧게 대기
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 출력 검증
    expect(terminal.outputData).toContain('Hello, World!');

    const internalOutputReader = shellSession.internalOutput?.getReader();
    const internalOutputResult = await internalOutputReader?.read();
    expect(internalOutputResult?.value).toBe('Hello, World!\n');

    // 셸 세션 종료 (한 글자씩 입력)
    await simulateTyping(terminal, 'exit\n');

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

  it('preview 이벤트가 트리거 되어야함', async () => {
    const serverCode = `const server = Bun.serve({
      port: 55174,
      fetch() {
        return new Response("서버 실행 중");
      },
    });

    // 특정 문자열이 입력됐을 때 서버 종료
    process.stdin.on('data', (data) => {
      if (data.toString().trim() === 'shutdown') {
        console.log('서버를 종료합니다...');
        server.stop();
        process.exit(0);
      }
    });

    // SIGINT, SIGTERM 핸들러 추가
    process.on('SIGINT', () => {
      console.log('SIGINT 신호를 받았습니다. 서버를 종료합니다...');
      server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM 신호를 받았습니다. 서버를 종료합니다...');
      server.stop();
      process.exit(0);
    });

    console.log('서버가 실행 중입니다. 종료하려면 "shutdown" 입력 또는 Ctrl+C를 누르세요.');`;

    await container.fs.writeFile('/serve.ts', serverCode);

    const terminal = new MockTerminal();
    const shellSession = await container.spawnShell(terminal);
    await shellSession.ready;

    const openPromise = new Promise<boolean>((resolve) => {
      const unsubscribePort = container.on('port', (port: number, type: string, url?: string) => {
        console.log('port event triggered: ', port, type, url);
        expect(port).toBe(55174);
        expect(type).toBe('open');
        resolve(true);
        unsubscribePort();
      });

      container.on('server-ready', (port: number) => {
        console.log('server-ready event triggered');
        expect(port).toBe(55174);
        resolve(true);
      });

      setTimeout(() => resolve(false), 5000);

      setTimeout(async () => {
        terminal.input('bun /serve.ts\n');
      }, 500);
    });

    // 이벤트가 발생했는지 확인
    const openEventReceived = await openPromise;
    expect(openEventReceived).toBe(true);

    const closePromise = new Promise<boolean>((resolve) => {
      const unsubscribePort = container.on('port', (port: number, type: string, url?: string) => {
        console.log('port event triggered: ', port, type, url);
        expect(port).toBe(55174);
        expect(type).toBe('close');
        resolve(true);
        unsubscribePort();
      });

      setTimeout(() => resolve(false), 5000);

      setTimeout(async () => {
        terminal.input('shutdown\n');
      }, 500);
    });

    const closeEventReceived = await closePromise;
    expect(closeEventReceived).toBe(true);
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

  it('watch와 watchPaths를 동시에 사용할 때 이벤트를 올바르게 구분해야 함', async () => {
    // 서로 다른 디렉토리 생성
    const watchDir = '/workspace/watch-dir';
    const watchPathsDir = '/workspace/watch-paths-dir';

    await container.fs.mkdir(watchDir, { recursive: true });
    await container.fs.mkdir(watchPathsDir, { recursive: true });

    // 각 디렉토리에 테스트 파일 생성
    await container.fs.writeFile(`${watchDir}/watch-file.txt`, '일반 감시 파일');
    await container.fs.writeFile(`${watchPathsDir}/paths-file.txt`, '경로 감시 파일');

    // 두 개의 이벤트 감지기 설정
    const watchEvents: string[] = [];
    const watchPathsEvents: string[] = [];

    // watch 설정
    const watcher = container.fs.watch(`workspace/watch-dir/**/*`, { persistent: true });
    watcher.addEventListener('change', (_eventType, filename) => {
      if (filename) {
        watchEvents.push(filename);
      }
    });

    // watchPaths 설정
    container.fs.watchPaths(
      {
        include: [`workspace/watch-paths-dir/**`],
      },
      (events) => {
        events.forEach((event) => {
          console.log('!!!!!!', event.path);
          watchPathsEvents.push(event.path);
        });
      },
    );

    // 이벤트 수신 Promise 생성
    const eventsPromise = new Promise<{ watchReceived: boolean; watchPathsReceived: boolean }>((resolve) => {
      let watchReceived = false;
      let watchPathsReceived = false;

      // 타임아웃 설정
      const timeoutId = setTimeout(() => {
        resolve({ watchReceived, watchPathsReceived });
      }, 5000);

      // 이벤트 체크 인터벌 설정
      const checkInterval = setInterval(() => {
        if (watchEvents.length > 0) {
          watchReceived = true;
        }

        if (watchPathsEvents.length > 0) {
          watchPathsReceived = true;
        }

        if (watchReceived && watchPathsReceived) {
          clearTimeout(timeoutId);
          clearInterval(checkInterval);
          resolve({ watchReceived, watchPathsReceived });
        }
      }, 100);

      // 각 파일에 대한 변경 이벤트 발생
      setTimeout(async () => {
        await container.fs.writeFile(`${watchDir}/watch-file.txt`, '일반 감시 파일 수정됨');
      }, 500);

      setTimeout(async () => {
        await container.fs.writeFile(`${watchPathsDir}/paths-file.txt`, '경로 감시 파일 수정됨');
      }, 1000);
    });

    // 결과 확인
    const { watchReceived, watchPathsReceived } = await eventsPromise;

    // 각 감시 메서드가 자신의 파일만 감지하는지 확인
    expect(watchReceived).toBe(true);
    expect(watchPathsReceived).toBe(true);

    expect(watchEvents.some((path) => path.includes('watch-file.txt'))).toBe(true);
    expect(watchEvents.some((path) => path.includes('paths-file.txt'))).toBe(false);

    expect(watchPathsEvents.some((path) => path.includes('paths-file.txt'))).toBe(true);
    expect(watchPathsEvents.some((path) => path.includes('watch-file.txt'))).toBe(false);

    // 정리
    watcher.close();
    await container.fs.rm(watchDir, { recursive: true });
    await container.fs.rm(watchPathsDir, { recursive: true });
  });
});
