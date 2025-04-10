/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { MODEL_REGEX, PROVIDER_REGEX, ATTACHMENTS_REGEX } from '~/utils/constants';
import { Markdown } from './Markdown';
import FilePreview from './FilePreview';

interface UserMessageProps {
  content: string;
}

export function UserMessage({ content }: UserMessageProps) {
  const textContent = stripMetadata(content);
  const attachments = content ? extractAttachments(content) : [];

  return (
    <div className="overflow-hidden pt-[4px]">
      <div className="flex flex-col gap-4">
        {textContent && <Markdown html>{textContent}</Markdown>}
        {attachments.length > 0 && (
          <FilePreview attachmentUrlList={attachments ? attachments.map((attachment: any) => attachment.url) : []} />
        )}
      </div>
    </div>
  );
}

function stripMetadata(content: string) {
  const artifactRegex = /<boltArtifact\s+[^>]*>[\s\S]*?<\/boltArtifact>/gm;
  return content
    .replace(MODEL_REGEX, '')
    .replace(PROVIDER_REGEX, '')
    .replace(ATTACHMENTS_REGEX, '')
    .replace(artifactRegex, '');
}

function extractAttachments(content: string) {
  const attachmentsMatch = content.match(ATTACHMENTS_REGEX);

  try {
    if (attachmentsMatch) {
      return JSON.parse(attachmentsMatch[1]);
    }
  } catch {}

  return [];
}
