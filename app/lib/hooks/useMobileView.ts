import { useState, useEffect } from 'react';
import { isMobile } from '~/utils/mobile';

/**
 * Custom hook for detecting mobile viewport
 * Uses the same breakpoint as the mobile utility (640px)
 */
export function useMobileView() {
  const [isMobileView, setIsMobileView] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(isMobile());
    };

    // Check on mount
    checkMobile();

    // Listen for resize events
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  return isMobileView;
}
