import React, { useState } from 'react';
import styles from './ToolCall.module.scss';

interface ToolCallProps {
  children: React.ReactElement<any, 'code'>;
}

export const ToolCall = ({ children }: ToolCallProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  try {
    const content = JSON.parse(children?.props?.children || '{}');

    return (
      <div className={styles.toolCall}>
        <div className={styles.toolCallHeader} onClick={() => setIsExpanded(!isExpanded)}>
          <h4>Tool Call: {content?.toolName}</h4>
          <span>{isExpanded ? '▼' : '▶'}</span>
        </div>
        {isExpanded && (
          <div className={styles.toolCallContent}>
            <div>
              <strong>Parameters:</strong>
              <pre>{JSON.stringify(content?.args, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    );
  } catch {
    return <div className={styles.toolCall}>Tool call parsing error: {String(children)}</div>;
  }
};
