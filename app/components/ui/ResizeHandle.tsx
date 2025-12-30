import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizeHandleProps {
  minChatWidth?: number;
  minWorkbenchWidth?: number;
}

export const ResizeHandle = ({ minChatWidth = 380, minWorkbenchWidth = 780 }: ResizeHandleProps) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const handleRef = useRef<HTMLDivElement | null>(null);

  const updateLayout = useCallback(
    (clientX: number) => {
      const windowWidth = window.innerWidth;
      const maxChatWidth = windowWidth - minWorkbenchWidth;
      const chatWidth = Math.max(minChatWidth, Math.min(maxChatWidth, clientX));

      document.documentElement.style.setProperty('--chat-width', `${chatWidth}px`);
    },
    [minChatWidth, minWorkbenchWidth],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
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

  // Initialize layout on mount (ensure workbench minimum width)
  useEffect(() => {
    const windowWidth = window.innerWidth;
    const maxChatWidth = windowWidth - minWorkbenchWidth;
    const initialChatWidth = Math.max(minChatWidth, Math.min(maxChatWidth, windowWidth * 0.5));

    document.documentElement.style.setProperty('--chat-width', `${initialChatWidth}px`);
  }, [minChatWidth, minWorkbenchWidth]);

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
      className="fixed top-[var(--header-height)] bottom-0 w-2 z-50 left-[calc(var(--chat-width)-4px)] cursor-col-resize"
    />
  );
};
