import type { Container } from './interfaces';
import { repoStore } from '~/lib/stores/repo';

/**
 * Creates a .env file in the container.
 * The file is only created if chatId exists and the file doesn't already exist.
 *
 * @param containerInstance Container instance
 * @returns Promise<void>
 */
export async function createDefaultEnv(containerInstance: Container): Promise<void> {
  try {
    // Check if chatId exists
    const chatId = repoStore.get().name;

    if (!chatId) {
      console.warn('Cannot create .env file: chatId is not available yet');
      return;
    }

    // Check if .env file already exists
    let envFileExists = false;

    try {
      await containerInstance.fs.readFile('.env');
      envFileExists = true;
      console.log('.env file already exists');
    } catch {
      // Ignore error if file doesn't exist
      console.log('No .env file found, creating one');
    }

    // Only create .env file if it doesn't exist
    if (!envFileExists) {
      const envContent = `VITE_AGENT8_VERSE=${chatId}
`;
      const envFilePath = '.env'; // Relative path
      await containerInstance.fs.writeFile(envFilePath, envContent);
      console.log(`Created default .env file at ${envFilePath} with VITE_AGENT8_VERSE=${chatId}`);
    }
  } catch (error) {
    console.error('Failed to create default .env file:', error);
  }
}
