import { useState } from 'react';
import styles from './ToolCall.module.scss';

export interface ToolCall {
  toolName: string;
  args: Record<string, any>;
}

interface ToolCallProps {
  toolCall: ToolCall;
}

export const ToolCall = ({ toolCall }: ToolCallProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={styles.toolCall}>
      <div className={styles.toolCallHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <h4>Tool Call: {toolCall.toolName}</h4>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className={styles.toolCallContent}>
          <div>
            <strong>Parameters:</strong>
            <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
