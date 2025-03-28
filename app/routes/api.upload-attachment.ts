import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { v4 as uuidv4 } from 'uuid';
import { ATTACHMENT_EXTS } from '~/utils/constants';

export async function action(args: ActionFunctionArgs) {
  return imageUploadAction(args);
}

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

export async function uploadAttachment(file: File, path: string, verse: string): Promise<UploadResult> {
  try {
    if (!file || !path || !verse) {
      throw new Error('Missing required fields: file, path, or verse');
    }

    const fileName = file.name;

    const fileExt = `.${fileName.split('.').pop()?.toLowerCase()}`;
    const uniqueFileName = `${uuidv4().slice(0, 16)}${fileExt}`;

    if (!ATTACHMENT_EXTS.includes(fileExt)) {
      throw new Error('Only image files are allowed');
    }

    const endpoint = 'https://verse8-simple-game-backend-609824224664.asia-northeast3.run.app';
    const signature = 'bolt-verse-signature';

    const externalFormData = new FormData();
    externalFormData.append('file', new File([await file.arrayBuffer()], uniqueFileName, { type: file.type }));
    externalFormData.append('path', path);

    const response = await fetch(`${endpoint}/verses/${verse}/files`, {
      method: 'POST',
      headers: {
        'X-Signature': signature,
      },
      body: externalFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }

    const assetUrl = `https://agent8-games.verse8.io/${verse}/${path}/${uniqueFileName}`;

    return {
      success: true,
      url: assetUrl,
    };
  } catch (error: any) {
    console.error('Error uploading image:', error);
    return {
      success: false,
      error: error.message || 'Unknown error during upload',
    };
  }
}

export function isBase64Image(base64String: string): boolean {
  if (!base64String || !base64String.startsWith('data:')) {
    return false;
  }

  const matches = base64String.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);

  if (!matches || matches.length !== 3) {
    return false;
  }

  return true;
}
export async function uploadBase64Image(base64String: string, path: string, verse: string): Promise<UploadResult> {
  try {
    // Validate base64 string
    if (!base64String || !base64String.startsWith('data:')) {
      throw new Error('Invalid base64 image format');
    }

    // Split data type and base64 part
    const matches = base64String.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 image format');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];

    // Convert base64 data to binary
    const binaryData = atob(base64Data);
    const bytes = new Uint8Array(binaryData.length);

    for (let i = 0; i < binaryData.length; i++) {
      bytes[i] = binaryData.charCodeAt(i);
    }

    // Create Blob
    const blob = new Blob([bytes], { type: mimeType });

    // Determine file extension
    let extension = 'png';

    if (mimeType === 'image/jpeg') {
      extension = 'jpg';
    } else if (mimeType === 'image/webp') {
      extension = 'webp';
    } else if (mimeType === 'image/gif') {
      extension = 'gif';
    } else if (mimeType === 'image/svg+xml') {
      extension = 'svg';
    }

    // Generate hash from binary data for filename
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    const shortHash = hashHex.slice(0, 16); // Use first 16 chars of hash

    // Create File object with hash-based filename
    const file = new File([blob], `${shortHash}.${extension}`, { type: mimeType });

    // Call uploadImage function
    return await uploadAttachment(file, path, verse);
  } catch (error: any) {
    console.error('Error uploading base64 image:', error);
    return {
      success: false,
      error: error.message || 'Unknown error during base64 image upload',
    };
  }
}

async function imageUploadAction({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const path = formData.get('path') as string;
    const verse = formData.get('verse') as string;

    if (!file || !path) {
      throw new Response('Missing required fields: file, path, or verse', {
        status: 400,
        statusText: 'Bad Request',
      });
    }

    const result = await uploadAttachment(file, path, verse);

    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }

    // 응답 반환
    return new Response(
      JSON.stringify({
        success: true,
        url: result.url,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error: any) {
    console.error('Error uploading image:', error);

    if (error instanceof Response) {
      throw error;
    }

    throw new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error during upload',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}
