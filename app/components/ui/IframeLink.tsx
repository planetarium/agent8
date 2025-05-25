import { forwardRef, useEffect, useState } from 'react';

interface IframeLinkProps {
  to: string;
  children: React.ReactNode;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

const isInIframe = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const getParentOrigin = () => {
  console.log('IframeLink: Detecting parent origin:', {
    referrer: document.referrer,
    currentOrigin: window.location.origin,
  });

  const url = import.meta.env.VITE_VIBE_AGENT8_URL || 'https://vibe.verse8.io';

  return url;
};

export const IframeLink = forwardRef<HTMLAnchorElement, IframeLinkProps>(
  ({ to, children, onClick, className, ...props }, ref) => {
    const [inIframe, setInIframe] = useState(false);

    useEffect(() => {
      const isIframe = isInIframe();
      setInIframe(isIframe);
      console.log('IframeLink: Initialization:', {
        inIframe: isIframe,
        referrer: document.referrer,
        currentOrigin: window.location.origin,
      });
    }, []);

    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      console.log('IframeLink: Click event:', {
        to,
        inIframe,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        button: event.button,
      });

      if (inIframe) {
        console.log('IframeLink: Intercepting click in iframe');
        event.preventDefault();

        let path = to;

        if (to.startsWith('/chat/')) {
          path = to.substring(6);
        } else if (to === '/') {
          path = '';
        }

        const parentOrigin = getParentOrigin();
        const isNewWindow = event.shiftKey || event.ctrlKey || event.metaKey || event.button === 1;

        console.log('IframeLink: Navigation details:', {
          parentOrigin,
          path,
          isNewWindow,
        });

        if (isNewWindow) {
          const parentUrl = `${parentOrigin}/games/editor?chat=${encodeURIComponent(path)}`;
          console.log('IframeLink: Opening new window:', parentUrl);

          try {
            window.open(parentUrl, '_blank');
          } catch (error) {
            console.error('IframeLink: Failed to open new window:', error);
          }
        } else {
          console.log('IframeLink: Normal navigation in iframe to:', to);
          window.location.href = to;
        }
      } else {
        console.log('IframeLink: Normal navigation outside iframe');
      }

      if (onClick) {
        onClick(event);
      }
    };

    const handleAuxClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (inIframe && event.button === 1) {
        console.log('IframeLink: Middle click intercepted');
        event.preventDefault();

        let path = to;

        if (to.startsWith('/chat/')) {
          path = to.substring(6);
        } else if (to === '/') {
          path = '';
        }

        const parentOrigin = getParentOrigin();
        const parentUrl = `${parentOrigin}/games/editor?chat=${encodeURIComponent(path)}`;

        console.log('IframeLink: Middle click opening new window:', parentUrl);

        try {
          window.open(parentUrl, '_blank');
        } catch (error) {
          console.error('IframeLink: Middle click failed:', error);
        }
      }
    };

    return (
      <a
        ref={ref}
        href={to}
        onClick={handleClick}
        onContextMenu={(e) => {
          if (inIframe) {
            console.log('IframeLink: Context menu disabled in iframe');
            e.preventDefault();
          }
        }}
        onAuxClick={handleAuxClick}
        className={className}
        {...props}
      >
        {children}
      </a>
    );
  },
);

IframeLink.displayName = 'IframeLink';
