import { useState, useEffect } from 'react';

const useViewport = (threshold = 1024) => {
  /*
   * Start with true (assume small viewport) to prevent flash on mobile
   * This means on large screens, workbench appears after hydration
   */
  const [isSmallViewport, setIsSmallViewport] = useState<boolean>(true);

  useEffect(() => {
    // Check actual viewport size on mount
    const checkViewport = () => setIsSmallViewport(window.innerWidth < threshold);

    checkViewport();
    window.addEventListener('resize', checkViewport);

    return () => {
      window.removeEventListener('resize', checkViewport);
    };
  }, [threshold]);

  return isSmallViewport;
};

export default useViewport;
