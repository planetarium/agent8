import Cookies from 'js-cookie';
import { createScopedLogger } from '~/utils/logger';
import { V8_ACCESS_TOKEN_KEY } from './userAuth';

const logger = createScopedLogger('verse8Api');

export interface VerseData {
  id: number;
  verseId: string;
  verseShortId: string;
  verseAddress: string | null;
  title: string;
  description: string;
  shortDescription: string;
  imageUrl: string;
  coverImageUrl: string | null;
  playUrl: string;
  category: string;
  tag: string[];
  buildVersion: string;
  deployTx: string;
  projectAddress: string;
  allowRemix: boolean;
  isMobileSupported: boolean;
  isPublic: boolean;
  visibility: string;
  parentVerseId: string | null;
  parentVerse: any | null;
  spinCount: number;
  realtimeUsers: number;
  dau: number;
  mau: number;
  sessions: number;
  avgSessionDuration: number;
  commentSize: number;
  likeSize: number;
  shareSize: number;
  gameSessions: number;
  featured: boolean;
  createdAt: string;
  userUid: string;
  userDisplayName: string;
  userHandle: string;
  userProfilePicture: string;
  isOwner: boolean;
}

// Extract project info from verse playUrl
export const extractProjectInfoFromPlayUrl = (playUrl: string) => {
  try {
    const url = new URL(playUrl);
    const chatId = url.searchParams.get('chatId');
    const sha = url.searchParams.get('sha') || 'develop';

    if (!chatId) {
      throw new Error('No chatId found in play URL');
    }

    // Decode the chatId to get the project path
    const projectPath = decodeURIComponent(chatId);

    return {
      projectPath,
      sha,
    };
  } catch {
    throw new Error('Invalid play URL format');
  }
};

export const fetchVerse = async (verseId: string, env?: any): Promise<VerseData | null> => {
  try {
    // Use provided env for server-side, import.meta.env for client-side
    const v8ApiEndpoint = env?.VITE_V8_API_ENDPOINT || import.meta.env.VITE_V8_API_ENDPOINT;

    if (!v8ApiEndpoint) {
      logger.warn('V8 API endpoint not configured');
      return null;
    }

    const response = await fetch(`${v8ApiEndpoint}/v1/verse/verseId?verseId=${encodeURIComponent(verseId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch verse data: ${response.status}`);
    }

    const verseData: VerseData = await response.json();

    return verseData;
  } catch (error) {
    logger.error('Failed to fetch verse data', error);
    return null;
  }
};

export const sendActivityPrompt = async (projectPath: string): Promise<boolean> => {
  try {
    const v8ApiEndpoint = import.meta.env.VITE_V8_API_ENDPOINT;

    if (!v8ApiEndpoint) {
      logger.warn('V8 API endpoint not configured');
      return false;
    }

    const accessToken = Cookies.get(V8_ACCESS_TOKEN_KEY) || localStorage.getItem(V8_ACCESS_TOKEN_KEY);

    if (!accessToken) {
      logger.warn('No V8 access token found');
      return false;
    }

    const timestamp = Date.now();
    const promptId = encodeURIComponent(projectPath + '-' + timestamp);

    const response = await fetch(v8ApiEndpoint + `/v1/activity/record-prompt/${promptId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to record prompt activity: ${response.status}`);
    }

    return true;
  } catch (error) {
    logger.error('Failed to record prompt activity', error);
    return false;
  }
};

export const sendActivityUploadAsset = async (): Promise<boolean> => {
  try {
    const v8ApiEndpoint = import.meta.env.VITE_V8_API_ENDPOINT;

    if (!v8ApiEndpoint) {
      logger.warn('V8 API endpoint not configured');
      return false;
    }

    const accessToken = Cookies.get(V8_ACCESS_TOKEN_KEY) || localStorage.getItem(V8_ACCESS_TOKEN_KEY);

    if (!accessToken) {
      logger.warn('No V8 access token found');
      return false;
    }

    const response = await fetch(v8ApiEndpoint + `/v1/activity/upload-asset`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to upload asset activity: ${response.status}`);
    }

    return true;
  } catch (error) {
    logger.error('Failed to upload asset activity', error);
    return false;
  }
};
