import { useEffect } from 'react';
import { toolUIStore } from '~/lib/stores/toolUI';

export interface ToolResult {
  isError: boolean;
  error?: string;
  result: any;
}

interface ToolResultProps {
  toolResult: ToolResult;
  id: string;
}

export const ToolResult = ({ id }: ToolResultProps) => {
  useEffect(() => {
    const currentTool = toolUIStore.get().tools?.[id] || {};
    toolUIStore.set({
      tools: {
        ...toolUIStore.get().tools,
        [id]: { ...currentTool, loaded: true },
      },
    });
  }, []);

  // Just mark as loaded, no UI needed
  return null;
};
