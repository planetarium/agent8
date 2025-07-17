import Cookies from 'js-cookie';
import { createScopedLogger } from '~/utils/logger';
import { V8_ACCESS_TOKEN_KEY } from './userAuth';

const logger = createScopedLogger('verse8Api');

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
