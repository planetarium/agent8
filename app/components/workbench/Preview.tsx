import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';
import { PortDropdown } from './PortDropdown';

type ResizeSide = 'left' | 'right' | null;

interface WindowSize {
  name: string;
  width: number;
  height: number;
  icon: string;
}

const WINDOW_SIZES: WindowSize[] = [
  { name: 'iPhone 14 Pro Max', width: 430, height: 932, icon: 'i-ph:device-mobile' },
  { name: 'iPhone SE', width: 375, height: 667, icon: 'i-ph:device-mobile' },
  { name: 'iPhone XR', width: 414, height: 896, icon: 'i-ph:device-mobile' },
  { name: 'iPhone 12 Pro', width: 390, height: 844, icon: 'i-ph:device-mobile' },
  { name: 'Pixel 5', width: 393, height: 851, icon: 'i-ph:device-mobile' },
  { name: 'Samsung Galaxy S8+', width: 360, height: 740, icon: 'i-ph:device-mobile' },
  { name: 'Samsung Galaxy S20 Ultra', width: 412, height: 915, icon: 'i-ph:device-mobile' },
  { name: 'iPad Air', width: 820, height: 1180, icon: 'i-ph:device-tablet' },
  { name: 'iPad Mini', width: 768, height: 1024, icon: 'i-ph:device-tablet' },
  { name: 'Surface Pro 7', width: 912, height: 1368, icon: 'i-ph:device-tablet' },
  { name: 'Surface Duo', width: 540, height: 720, icon: 'i-ph:device-tablet' },
  { name: 'Galaxy Fold', width: 280, height: 653, icon: 'i-ph:device-mobile' },
  { name: 'Nest Hub', width: 1024, height: 600, icon: 'i-ph:monitor' },
  { name: 'Nest Hub Max', width: 1280, height: 800, icon: 'i-ph:monitor' },
];

export const Preview = memo(() => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const hasSelectedPreview = useRef(false);
  const previews = useStore(workbenchStore.previews);
  const selectedView = useStore(workbenchStore.currentView);
  const activePreview = previews[activePreviewIndex];

  const [url, setUrl] = useState('');
  const [iframeUrl, setIframeUrl] = useState<string | undefined>();

  // Toggle between responsive mode and device mode
  const [isDeviceModeOn, setIsDeviceModeOn] = useState(false);

  // Device size selection for device mode
  const [selectedDeviceSize, setSelectedDeviceSize] = useState<WindowSize>(WINDOW_SIZES[0]);
  const [deviceScale, setDeviceScale] = useState<number>(1);

  // Use percentage for width (kept for backward compatibility in responsive mode)
  const [widthPercent, setWidthPercent] = useState<number>(37.5);

  const resizingState = useRef({
    isResizing: false,
    side: null as ResizeSide,
    startX: 0,
    startWidthPercent: 37.5,
    startDeviceWidth: 375,
    windowWidth: window.innerWidth,
  });

  const SCALING_FACTOR = 2;

  const [isWindowSizeDropdownOpen, setIsWindowSizeDropdownOpen] = useState(false);

  // Calculate optimal scale for device mode based on shortest dimension
  const calculateDeviceScale = useCallback(() => {
    if (!isDeviceModeOn || !containerRef.current) {
      return 1;
    }

    const container = containerRef.current.querySelector('.preview-container') as HTMLElement;

    if (!container) {
      return 1;
    }

    const containerRect = container.getBoundingClientRect();

    // Dynamic padding based on container size
    const minPadding = 40;
    const maxPadding = 80;
    const paddingX = Math.min(maxPadding, Math.max(minPadding, containerRect.width * 0.05));
    const paddingY = Math.min(maxPadding, Math.max(minPadding, containerRect.height * 0.08));

    const availableWidth = containerRect.width - paddingX;
    const availableHeight = containerRect.height - paddingY;

    // Calculate scale based on shortest dimension to maintain aspect ratio
    const scaleX = availableWidth / selectedDeviceSize.width;
    const scaleY = availableHeight / selectedDeviceSize.height;

    /*
     * Use the smaller scale to ensure device fits completely and maintains aspect ratio
     * Keep max scale at 100% to show exact device dimensions
     */
    const optimalScale = Math.min(scaleX, scaleY, 1.0);

    return Math.max(optimalScale, 0.2); // Minimum scale of 20%
  }, [isDeviceModeOn, selectedDeviceSize]);

  // Update device scale when container or device size changes
  useEffect(() => {
    if (isDeviceModeOn) {
      const scale = calculateDeviceScale();
      setDeviceScale(scale);
    } else {
      setDeviceScale(1);
    }
  }, [isDeviceModeOn, selectedDeviceSize, calculateDeviceScale]);

  useEffect(() => {
    if (!activePreview) {
      setUrl('');
      setIframeUrl(undefined);

      return;
    }

    const { baseUrl } = activePreview;
    setUrl(baseUrl);
    setIframeUrl(baseUrl);
  }, [activePreview]);

  const validateUrl = useCallback(
    (value: string) => {
      if (!activePreview) {
        return false;
      }

      const { baseUrl } = activePreview;

      if (value === baseUrl) {
        return true;
      } else if (value.startsWith(baseUrl)) {
        return ['/', '?', '#'].includes(value.charAt(baseUrl.length));
      }

      return false;
    },
    [activePreview],
  );

  const findMinPortIndex = useCallback(
    (minIndex: number, preview: { port: number }, index: number, array: { port: number }[]) => {
      return preview.port < array[minIndex].port ? index : minIndex;
    },
    [],
  );

  useEffect(() => {
    if (previews.length > 1 && !hasSelectedPreview.current) {
      const minPortIndex = previews.reduce(findMinPortIndex, 0);
      setActivePreviewIndex(minPortIndex);
    }
  }, [previews, findMinPortIndex]);

  const reloadPreview = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  useEffect(() => {
    if (selectedView === 'preview') {
      setTimeout(() => {
        reloadPreview();
      }, 300);
    }
  }, [selectedView, reloadPreview]);

  const toggleFullscreen = async () => {
    if (!isFullscreen && containerRef.current) {
      await containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleDeviceMode = () => {
    setIsDeviceModeOn((prev) => !prev);
  };

  const selectDeviceSize = (size: WindowSize) => {
    setSelectedDeviceSize(size);
  };

  const startResizing = (e: React.MouseEvent, side: ResizeSide) => {
    if (!isDeviceModeOn) {
      return;
    }

    document.body.style.userSelect = 'none';

    resizingState.current.isResizing = true;
    resizingState.current.side = side;
    resizingState.current.startX = e.clientX;
    resizingState.current.startWidthPercent = widthPercent;
    resizingState.current.startDeviceWidth = selectedDeviceSize.width;
    resizingState.current.windowWidth = window.innerWidth;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!resizingState.current.isResizing) {
      return;
    }

    const dx = e.clientX - resizingState.current.startX;

    if (isDeviceModeOn) {
      // In device mode, resize the actual device width
      let newDeviceWidth = resizingState.current.startDeviceWidth;

      if (resizingState.current.side === 'right') {
        newDeviceWidth = resizingState.current.startDeviceWidth + dx;
      } else if (resizingState.current.side === 'left') {
        newDeviceWidth = resizingState.current.startDeviceWidth - dx;
      }

      // Maintain aspect ratio
      const aspectRatio = selectedDeviceSize.height / selectedDeviceSize.width;

      // Limit minimum and maximum sizes
      newDeviceWidth = Math.max(200, Math.min(newDeviceWidth, 1920));

      const limitedDeviceHeight = newDeviceWidth * aspectRatio;

      setSelectedDeviceSize({
        ...selectedDeviceSize,
        width: Math.round(newDeviceWidth),
        height: Math.round(limitedDeviceHeight),
      });
    } else {
      // In responsive mode, use percentage-based resizing
      const windowWidth = resizingState.current.windowWidth;
      const dxPercent = (dx / windowWidth) * 100 * SCALING_FACTOR;

      let newWidthPercent = resizingState.current.startWidthPercent;

      if (resizingState.current.side === 'right') {
        newWidthPercent = resizingState.current.startWidthPercent + dxPercent;
      } else if (resizingState.current.side === 'left') {
        newWidthPercent = resizingState.current.startWidthPercent - dxPercent;
      }

      newWidthPercent = Math.max(10, Math.min(newWidthPercent, 90));
      setWidthPercent(newWidthPercent);
    }
  };

  const onMouseUp = () => {
    resizingState.current.isResizing = false;
    resizingState.current.side = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    document.body.style.userSelect = '';
  };

  useEffect(() => {
    const handleWindowResize = () => {
      if (isDeviceModeOn) {
        const scale = calculateDeviceScale();
        setDeviceScale(scale);
      }
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [isDeviceModeOn, selectedDeviceSize, calculateDeviceScale]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'iframe-error') {
        const { error } = event.data;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        let title = 'Error in Preview';
        const description = error.message || 'An error occurred in the preview';

        if (error.type === 'unhandled-rejection') {
          title = 'Unhandled Promise Rejection';
        } else if (error.type === 'uncaught-exception') {
          title = 'Uncaught Exception';
        } else if (error.type === 'console-error') {
          title = 'Console Error';
        }

        if (error.stack) {
          const ignoreErrors = [
            'HMRClient',
            `Couldn't load texture blob`,
            'null pointer passed to rust',
            'Failed to load animation',
          ];

          if (ignoreErrors.some((text) => error.stack.includes(text))) {
            return;
          }

          workbenchStore.actionAlert.set({
            type: 'preview',
            title,
            description,
            content: `Error occurred at ${error.pathname}${error.search || ''}${error.hash || ''}\nPort: ${error.port || ''}\n\nStack trace:\n${error.stack || ''}`,
            source: 'preview',
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const GripIcon = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          color: 'rgba(0,0,0,0.5)',
          fontSize: '10px',
          lineHeight: '5px',
          userSelect: 'none',
          marginLeft: '1px',
        }}
      >
        ••• •••
      </div>
    </div>
  );

  const openInNewWindow = (size: WindowSize) => {
    if (activePreview?.baseUrl) {
      const match = activePreview.baseUrl.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);
      let previewUrl = activePreview.baseUrl;

      if (match) {
        const previewId = match[1];
        previewUrl = `/webcontainer/preview/${previewId}`;
      }

      const newWindow = window.open(
        previewUrl,
        '_blank',
        `noopener,noreferrer,width=${size.width},height=${size.height},menubar=no,toolbar=no,location=no,status=no`,
      );

      if (newWindow) {
        newWindow.focus();
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex flex-col relative ${isPreviewOnly ? 'fixed inset-0 z-50 bg-white' : ''}`}
    >
      {isPortDropdownOpen && (
        <div className="z-iframe-overlay w-full h-full absolute" onClick={() => setIsPortDropdownOpen(false)} />
      )}
      <div className="bg-bolt-elements-background-depth-2 p-2 flex items-center gap-2">
        <div className="flex items-center gap-2">
          <IconButton icon="i-ph:arrow-clockwise" onClick={reloadPreview} />
        </div>

        <div className="flex-grow flex items-center gap-1 bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-3 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover hover:focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within-border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive">
          <input
            title="URL"
            ref={inputRef}
            className="w-full bg-transparent outline-none"
            type="text"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && validateUrl(url)) {
                setIframeUrl(url);

                if (inputRef.current) {
                  inputRef.current.blur();
                }
              }
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          {previews.length > 1 && (
            <PortDropdown
              activePreviewIndex={activePreviewIndex}
              setActivePreviewIndex={setActivePreviewIndex}
              isDropdownOpen={isPortDropdownOpen}
              setHasSelectedPreview={(value) => (hasSelectedPreview.current = value)}
              setIsDropdownOpen={setIsPortDropdownOpen}
              previews={previews}
            />
          )}

          <div className="flex items-center relative">
            <IconButton
              icon="i-ph:devices"
              onClick={toggleDeviceMode}
              title={isDeviceModeOn ? 'Switch to Responsive Mode' : 'Switch to Device Mode'}
              className={isDeviceModeOn ? 'bg-blue-500 text-white hover:bg-blue-600' : 'hover:bg-gray-100'}
            />

            {isDeviceModeOn && (
              <>
                <IconButton
                  icon="i-ph:caret-down"
                  onClick={() => setIsWindowSizeDropdownOpen(!isWindowSizeDropdownOpen)}
                  className="ml-1"
                  title="Select Device Size"
                />

                {isWindowSizeDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-50" onClick={() => setIsWindowSizeDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 min-w-[240px] max-h-[400px] bg-white dark:bg-black rounded-xl shadow-2xl border border-[#E5E7EB] dark:border-[rgba(255,255,255,0.1)] overflow-hidden overflow-y-auto">
                      {WINDOW_SIZES.map((size) => (
                        <button
                          key={size.name}
                          className={`w-full px-4 py-3.5 text-left text-[#111827] dark:text-gray-300 text-sm whitespace-nowrap flex items-center gap-3 group hover:bg-[#F5EEFF] dark:hover:bg-gray-900 bg-white dark:bg-black ${
                            selectedDeviceSize.name === size.name ? 'bg-[#F5EEFF] dark:bg-gray-900' : ''
                          }`}
                          onClick={() => {
                            selectDeviceSize(size);
                            setIsWindowSizeDropdownOpen(false);
                          }}
                        >
                          <div
                            className={`${size.icon} w-5 h-5 text-[#6B7280] dark:text-gray-400 group-hover:text-[#6D28D9] dark:group-hover:text-[#6D28D9] transition-colors duration-200`}
                          />
                          <div className="flex flex-col">
                            <span className="font-medium group-hover:text-[#6D28D9] dark:group-hover:text-[#6D28D9] transition-colors duration-200">
                              {size.name}
                            </span>
                            <span className="text-xs text-[#6B7280] dark:text-gray-400 group-hover:text-[#6D28D9] dark:group-hover:text-[#6D28D9] transition-colors duration-200">
                              {size.width} × {size.height}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <IconButton
            icon="i-ph:layout-light"
            onClick={() => setIsPreviewOnly(!isPreviewOnly)}
            title={isPreviewOnly ? 'Show Full Interface' : 'Show Preview Only'}
          />

          <IconButton
            icon={isFullscreen ? 'i-ph:arrows-in' : 'i-ph:arrows-out'}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          />

          <IconButton
            icon="i-ph:arrow-square-out"
            onClick={() => openInNewWindow(isDeviceModeOn ? selectedDeviceSize : WINDOW_SIZES[0])}
            title={`Open Preview in New Window`}
          />
        </div>
      </div>

      <div className="flex-1 border-t border-bolt-elements-borderColor flex justify-center items-center overflow-auto preview-container">
        <div
          style={{
            width: isDeviceModeOn ? `${selectedDeviceSize.width}px` : '100%',
            height: isDeviceModeOn ? `${selectedDeviceSize.height}px` : '100%',
            aspectRatio: isDeviceModeOn ? `${selectedDeviceSize.width} / ${selectedDeviceSize.height}` : 'unset',
            minWidth: isDeviceModeOn ? `${selectedDeviceSize.width}px` : 'auto',
            minHeight: isDeviceModeOn ? `${selectedDeviceSize.height}px` : 'auto',
            maxWidth: isDeviceModeOn ? `${selectedDeviceSize.width}px` : '100%',
            maxHeight: isDeviceModeOn ? `${selectedDeviceSize.height}px` : '100%',
            transform: isDeviceModeOn ? `scale(${deviceScale})` : 'none',
            transformOrigin: 'center center',
            overflow: isDeviceModeOn ? 'hidden' : 'visible',
            background: 'var(--bolt-elements-background-depth-1)',
            position: 'relative',
            display: 'flex',
            border: isDeviceModeOn ? '2px solid #d1d5db' : 'none',
            borderRadius: isDeviceModeOn ? '16px' : '0',
            boxShadow: isDeviceModeOn ? '0 25px 50px -12px rgba(0,0,0,0.25)' : 'none',
          }}
        >
          {/* Device info overlay */}
          {isDeviceModeOn && (
            <div
              style={{
                position: 'absolute',
                top: `-50px`,
                left: '50%',
                transform: `translateX(-50%) scale(${Math.max(1 / deviceScale, 0.8)})`,
                background: 'rgba(0,0,0,0.85)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: '600',
                whiteSpace: 'nowrap',
                zIndex: 10,
                pointerEvents: 'none',
                border: '1px solid rgba(255,255,255,0.2)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {selectedDeviceSize.name} • {selectedDeviceSize.width} × {selectedDeviceSize.height} •{' '}
              {Math.round(deviceScale * 100)}%
            </div>
          )}

          {activePreview ? (
            <>
              <iframe
                ref={iframeRef}
                title="preview"
                className="border-none w-full h-full bg-bolt-elements-background-depth-1"
                src={iframeUrl}
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-storage-access-by-user-activation allow-same-origin allow-pointer-lock allow-downloads"
                allow="cross-origin-isolated"
              />
            </>
          ) : (
            <div className="flex w-full h-full justify-center items-center bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
              No preview available
            </div>
          )}

          {isDeviceModeOn && (
            <>
              <div
                onMouseDown={(e) => startResizing(e, 'left')}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '-20px',
                  width: '20px',
                  height: '60px',
                  marginTop: '-30px',
                  cursor: 'ew-resize',
                  background: 'rgba(59, 130, 246, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  userSelect: 'none',
                  borderRadius: '12px 0 0 12px',
                  transform: `scale(${Math.max(1 / deviceScale, 0.8)})`,
                  transformOrigin: 'center right',
                  zIndex: 5,
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 1)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)')}
                title="Drag to resize device"
              >
                <GripIcon />
              </div>

              <div
                onMouseDown={(e) => startResizing(e, 'right')}
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: '-20px',
                  width: '20px',
                  height: '60px',
                  marginTop: '-30px',
                  cursor: 'ew-resize',
                  background: 'rgba(59, 130, 246, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  userSelect: 'none',
                  borderRadius: '0 12px 12px 0',
                  transform: `scale(${Math.max(1 / deviceScale, 0.8)})`,
                  transformOrigin: 'center left',
                  zIndex: 5,
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 1)')}
                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 0.8)')}
                title="Drag to resize device"
              >
                <GripIcon />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
