export function isMobile() {
  // we use sm: as the breakpoint for mobile. It's currently set to 768px
  return globalThis.innerWidth < 760;
}

export function isMobileOS() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.vendor || '';

  // iOS detection
  if (/iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream) {
    return true;
  }

  // Android detection
  if (/android/i.test(userAgent)) {
    return true;
  }

  // Other mobile OS detection (BlackBerry, Windows Phone, etc.)
  if (/BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(userAgent)) {
    return true;
  }

  return false;
}
