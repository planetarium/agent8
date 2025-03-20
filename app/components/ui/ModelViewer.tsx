import React from 'react';
import '@google/model-viewer';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src: string;
        'auto-rotate'?: string;
        'camera-controls'?: string;
        ar?: string;
        'shadow-intensity'?: string;
        exposure?: string;
      };
    }
  }
}

interface ModelViewerProps {
  url: string;
  className?: string;
  width?: string;
  height?: string;
}

export const ModelViewer: React.FC<ModelViewerProps> = ({ url, className, width = '100%', height = '100%' }) => {
  return (
    <model-viewer
      style={{ width, height, backgroundColor: '#2a2a2a' }}
      className={className}
      src={url}
      auto-rotate="true"
      camera-controls="true"
      ar="false"
      shadow-intensity="1"
      exposure="0.75"
    ></model-viewer>
  );
};
