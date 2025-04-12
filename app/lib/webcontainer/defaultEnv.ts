import type { WebContainer } from '@webcontainer/api';
import { repoStore } from '~/lib/stores/repo';

/**
 * WebContainer에 .env 파일을 생성합니다.
 * chatId가 있는 경우에만 파일을 생성하며, 이미 파일이 존재하는 경우에는 생성하지 않습니다.
 *
 * @param webcontainerInstance WebContainer 인스턴스
 * @returns Promise<void>
 */
export async function createDefaultEnv(webcontainerInstance: WebContainer): Promise<void> {
  try {
    // chatId가 있는지 확인
    const chatId = repoStore.get().name;

    if (!chatId) {
      console.warn('Cannot create .env file: chatId is not available yet');
      return;
    }

    // .env 파일 존재 여부 확인
    let envFileExists = false;

    try {
      await webcontainerInstance.fs.readFile('.env');
      envFileExists = true;
      console.log('.env file already exists');
    } catch {
      // 파일이 없는 경우 에러가 발생하므로 여기서는 무시
      console.log('No .env file found, creating one');
    }

    // .env 파일이 없는 경우에만 생성
    if (!envFileExists) {
      const envContent = `VITE_AGENT8_VERSE=${chatId}
`;
      const envFilePath = '.env'; // 상대 경로
      await webcontainerInstance.fs.writeFile(envFilePath, envContent);
      console.log(`Created default .env file at ${envFilePath} with VITE_AGENT8_VERSE=${chatId}`);
    }
  } catch (error) {
    console.error('Failed to create default .env file:', error);
  }
}
