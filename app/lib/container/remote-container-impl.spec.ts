import { WebSocket } from 'ws';
import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { RemoteContainerFactory, RemoteContainerFileSystem } from '~/lib/container/remote-container-impl';
import type { FileSystemTree, Container } from '~/lib/container/interfaces';
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
      process.output.pipeTo(
        new WritableStream({
          write(chunk) {
            result += chunk;
          },
          close() {
            resolve(result.trim());
          },
        }),
      );
    });

    // 검증
    expect(output).toBe('Hello, World!');
  });

  it('셸 세션을 생성하고 명령을 실행할 수 있어야 함', async () => {
    // 터미널 생성
    const terminal = new MockTerminal();

    // 셸 세션 생성
    const shellSession = await container.spawnShell(terminal);

    // 셸이 준비될 때까지 대기
    await shellSession.ready;

    // 명령어 입력을 위한 Writer 가져오기
    const writer = shellSession.input;

    // 간단한 명령어 실행 (echo)
    writer.write('echo "Shell Command Test"\n');

    // 셸 세션 종료
    writer.write('exit\n');

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
    const content = await container.fs.readFile('/workspace/test-mount.txt', 'utf8');
    expect(content).toBe('마운트된 파일 내용');

    // 디렉토리 내 파일 읽기
    const dirContent = await container.fs.readFile('/workspace/test-dir/test-file.txt', 'utf8');
    expect(dirContent).toBe('디렉토리 내 파일');

    // 정리
    await container.fs.rm('/workspace/test-mount.txt');
    await container.fs.rm('/workspace/test-dir', { recursive: true });
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
});
