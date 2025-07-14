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
  const stored = sessionStorage.getItem('iframe_parent_origin');

  if (stored) {
    return stored;
  }

  if (document.referrer) {
    try {
      const referrerUrl = new URL(document.referrer);

      if (referrerUrl.origin !== window.location.origin) {
        sessionStorage.setItem('iframe_parent_origin', referrerUrl.origin);
        console.log('IframeLink: Got parent origin from referrer:', referrerUrl.origin);

        return referrerUrl.origin;
      }
    } catch {}
  }

  const url = import.meta.env.VITE_VIBE_AGENT8_URL || 'https://vibe.verse8.io';
  sessionStorage.setItem('iframe_parent_origin', url);
  console.log('IframeLink: Using fallback URL:', url);

  return url;
};

export const IframeLink = forwardRef<HTMLAnchorElement, IframeLinkProps>(
  ({ to, children, onClick, className, ...props }, ref) => {
    const [inIframe, setInIframe] = useState(false);

    useEffect(() => {
      const isIframe = isInIframe();
      setInIframe(isIframe);

      if (isIframe) {
        getParentOrigin();
      }
    }, []);

    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (inIframe) {
        event.preventDefault();

        let path = to;

        if (to.startsWith('/chat/')) {
          path = to.substring(6);
        } else if (to === '/') {
          path = '';
        }

        const parentOrigin = getParentOrigin();
        const isNewWindow = event.shiftKey || event.ctrlKey || event.metaKey || event.button === 1;

        if (isNewWindow) {
          const parentUrl = `${parentOrigin}/creator/editor?chat=${encodeURIComponent(path)}`;
          console.log('IframeLink: Opening new window:', parentUrl);

          try {
            window.open(parentUrl, '_blank');
          } catch (error) {
            console.error('IframeLink: Failed to open new window:', error);
          }
        } else {
          console.log('IframeLink: Navigation in iframe to:', to);
          window.location.href = to;
        }
      }

      if (onClick) {
        onClick(event);
      }
    };

    const handleAuxClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (inIframe && event.button === 1) {
        event.preventDefault();

        let path = to;

        if (to.startsWith('/chat/')) {
          path = to.substring(6);
        } else if (to === '/') {
          path = '';
        }

        const parentOrigin = getParentOrigin();
        const parentUrl = `${parentOrigin}/creator/editor?chat=${encodeURIComponent(path)}`;

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
