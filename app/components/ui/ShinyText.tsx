import React from 'react';

interface ShinyTextProps {
  text?: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
  children?: React.ReactNode;
}

export function ShinyText({ text, disabled = false, speed = 5, className = '', children }: ShinyTextProps) {
  const uniqueId = React.useId();
  const keyframeName = `shine-${uniqueId.replace(/:/g, '')}`;

  return (
    <>
      <style>
        {`
          @keyframes ${keyframeName} {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}
      </style>
      <div className={`inline-block relative ${className}`}>
        {/* Base text */}
        <div className="text-primary">{children || text}</div>
        {/* Shine overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(120deg, rgba(114, 231, 248, 0) 40%, rgba(114, 231, 248, 0.8) 50%, rgba(114, 231, 248, 0) 60%)`,
            backgroundSize: '200% 100%',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            color: 'transparent',
            animation: disabled ? 'none' : `${keyframeName} ${speed}s linear infinite`,
          }}
        >
          {children || text}
        </div>
      </div>
    </>
  );
}
