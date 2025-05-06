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
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  console.log('toolCall', toolCall);

  return (
    <div className={styles.toolCall}>
      <div className={styles.toolCallHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.toolInfo}>
          <span className={styles.toolLabel}>Tool Call:</span>
          <span className={styles.toolName}>{toolCall.toolName}</span>
        </div>
        <span className={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className={styles.toolCallContent}>
          <div className={styles.parameterSection}>
            <span className={styles.parameterLabel}>Parameters:</span>
            <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
