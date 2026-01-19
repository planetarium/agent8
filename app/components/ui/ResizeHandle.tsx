import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizeHandleProps {
  minChatWidth?: number;
  minWorkbenchWidth?: number;
}

export const ResizeHandle = ({ minChatWidth = 380, minWorkbenchWidth = 780 }: ResizeHandleProps) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const hasUserResized = useRef<boolean>(false);

  const updateLayout = useCallback(
    (clientX: number) => {
      const windowWidth = window.innerWidth;
      const maxChatWidth = windowWidth - minWorkbenchWidth;
      const chatWidth = Math.max(minChatWidth, Math.min(maxChatWidth, clientX));

      document.documentElement.style.setProperty('--chat-width', `${chatWidth}px`);
    },
    [minChatWidth, minWorkbenchWidth],
  );

  const applyInitialRatio = useCallback(() => {
    const windowWidth = window.innerWidth;
    const maxChatWidth = windowWidth - minWorkbenchWidth;
    const chatRatio = 1 / 3; // 1:2 ratio → chat gets 1/(1+2) of the width
    const initialChatWidth = Math.max(minChatWidth, Math.min(maxChatWidth, windowWidth * chatRatio));

    document.documentElement.style.setProperty('--chat-width', `${initialChatWidth}px`);
  }, [minChatWidth, minWorkbenchWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    hasUserResized.current = true;
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      updateLayout(e.clientX);
    },
    [isDragging, updateLayout],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  /*
   * Initialize layout on mount (ensure workbench minimum width)
   * Target ratio: chat:workbench = 1:2
   */
  useEffect(() => {
    applyInitialRatio();
  }, [applyInitialRatio]);

  /*
   * Handle window resize: maintain 1:2.4 ratio unless user manually resized
   */
  useEffect(() => {
    const handleResize = () => {
      if (!hasUserResized.current) {
        applyInitialRatio();
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [applyInitialRatio]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.classList.add('resizing');
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('resizing');
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className="fixed top-[var(--header-height)] bottom-0 w-3 z-50 left-[var(--chat-width)] cursor-col-resize"
    />
  );
};
