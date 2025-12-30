/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useRef, useState, useEffect } from 'react';
import { MODEL_REGEX, PROVIDER_REGEX, ATTACHMENTS_REGEX, DEV_TAG_REGEX } from '~/utils/constants';
import { Markdown } from './Markdown';
import FilePreview from './FilePreview';
import { ChevronRightIcon } from '~/components/ui/Icons';

interface UserMessageProps {
  content: string;
  isLast?: boolean;
}

export function UserMessage({ content, isLast = false }: UserMessageProps) {
  const textContent = stripMetadata(content);
  const attachments = content ? extractAttachments(content) : [];

  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(isLast);

  // Check if text overflows 3 lines
  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current) {
        const element = textRef.current;
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 24;
        const maxHeight = lineHeight * 3;

        // Check if content exceeds 3 lines
        setIsOverflowing(element.scrollHeight > maxHeight + 4); // 4px tolerance
      }
    };

    checkOverflow();

    // Re-check on window resize
    window.addEventListener('resize', checkOverflow);

    return () => window.removeEventListener('resize', checkOverflow);
  }, [textContent]);

  return (
    <div className="overflow-hidden pt-[4px] text-body-md-regular-relaxed text-secondary">
      <div className="flex flex-col gap-4">
        {textContent && (
          <div>
            <div ref={textRef} className={!expanded && isOverflowing ? 'line-clamp-3' : ''}>
              <Markdown html>{textContent}</Markdown>
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <FilePreview attachmentUrlList={attachments ? attachments.map((attachment: any) => attachment.url) : []} />
        )}
      </div>

      {/* Show All / Hide button */}
      {isOverflowing && (
        <div className="flex justify-end pt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex text-interactive-neutral text-heading-xs bg-transparent gap-0.5 items-center"
          >
            {expanded ? 'Hide' : 'Show All'}
            <ChevronRightIcon width={16} height={16} fill="currentColor" className={expanded ? '-rotate-90' : ''} />
          </button>
        </div>
      )}
    </div>
  );
}

export function stripMetadata(content: string) {
  const artifactRegex = /<boltArtifact\s+[^>]*>[\s\S]*?<\/boltArtifact>/gm;
  const thinkRegex = /<think>[\s\S]*?<\/think>/gm;

  return content
    .replace(MODEL_REGEX, '')
    .replace(PROVIDER_REGEX, '')
    .replace(ATTACHMENTS_REGEX, '')
    .replace(DEV_TAG_REGEX, '')
    .replace(artifactRegex, '')
    .replace(thinkRegex, '');
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
