/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useRef, useState, useEffect } from 'react';
import { MODEL_REGEX, PROVIDER_REGEX, ATTACHMENTS_REGEX, DEV_TAG_REGEX, TERMINAL_ERROR_TEXT } from '~/utils/constants';
import { Markdown } from './Markdown';
import FilePreview from './FilePreview';
import { ChevronRightIcon } from '~/components/ui/Icons';

interface UserMessageProps {
  content: string;
  isLast?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function UserMessage({ content, isLast = false, expanded: externalExpanded, onToggleExpand }: UserMessageProps) {
  const textContent = stripMetadata(content);
  const attachments = content ? extractAttachments(content) : [];

  const textRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState<boolean>(false);
  const [internalExpanded, setInternalExpanded] = useState<boolean>(isLast);
  const expanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const isControlled = externalExpanded !== undefined;

  // Collapse when this message is no longer the last one (only for uncontrolled components)
  useEffect(() => {
    if (!isControlled && !isLast) {
      setInternalExpanded(false);
    }
  }, [isLast, isControlled]);

  // Handle expand/collapse with upward expansion (keep bottom fixed)
  const handleToggleExpand = () => {
    if (isControlled && onToggleExpand) {
      // External toggle function provided (e.g., for terminal errors)
      onToggleExpand();
    } else if (!isControlled) {
      // Internal toggle logic
      if (!expanded && containerRef.current) {
        // Get scroll container (chat container)
        const scrollContainer = containerRef.current.closest('.chat-container');

        if (scrollContainer) {
          const prevHeight = containerRef.current.offsetHeight;

          setInternalExpanded(true);

          // After state update, adjust scroll position
          requestAnimationFrame(() => {
            if (containerRef.current) {
              const newHeight = containerRef.current.offsetHeight;
              const heightDiff = newHeight - prevHeight;
              scrollContainer.scrollTop += heightDiff;
            }
          });
        } else {
          setInternalExpanded(true);
        }
      } else {
        setInternalExpanded(false);
      }
    }
  };

  // Check if content has code blocks (```)
  const hasCodeBlock = textContent.includes('```');

  // Max height for collapsed state (approximately 3 lines)
  const MAX_COLLAPSED_HEIGHT = 72; // 24px line-height * 3 lines

  // Check if text overflows 3 lines
  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current) {
        const element = textRef.current;

        if (hasCodeBlock) {
          // For code blocks, use max-height comparison
          setIsOverflowing(element.scrollHeight > MAX_COLLAPSED_HEIGHT + 4);
        } else {
          // For regular text, use line-height based comparison
          const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 24;
          const maxHeight = lineHeight * 3;
          setIsOverflowing(element.scrollHeight > maxHeight + 4);
        }
      }
    };

    checkOverflow();

    // Re-check on window resize
    window.addEventListener('resize', checkOverflow);

    return () => window.removeEventListener('resize', checkOverflow);
  }, [textContent, hasCodeBlock]);

  return (
    <div ref={containerRef} className="overflow-hidden text-body-md-regular-relaxed text-secondary">
      <div className="flex flex-col gap-4">
        {textContent && (
          <div>
            <div
              ref={textRef}
              className={
                !expanded && (isOverflowing || textContent.includes(TERMINAL_ERROR_TEXT))
                  ? hasCodeBlock
                    ? 'overflow-hidden'
                    : 'line-clamp-3'
                  : ''
              }
              style={
                !expanded && (isOverflowing || textContent.includes(TERMINAL_ERROR_TEXT)) && hasCodeBlock
                  ? { maxHeight: `${MAX_COLLAPSED_HEIGHT}px`, overflow: 'hidden' }
                  : undefined
              }
            >
              <Markdown html>{textContent}</Markdown>
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <FilePreview attachmentUrlList={attachments ? attachments.map((attachment: any) => attachment.url) : []} />
        )}
      </div>

      {/* Show All / Hide button */}
      {(isOverflowing || textContent.includes(TERMINAL_ERROR_TEXT)) && (
        <div className="flex justify-end pt-2">
          <button
            onClick={handleToggleExpand}
            className="flex text-interactive-neutral text-heading-2xs bg-transparent gap-0.5 items-center"
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
