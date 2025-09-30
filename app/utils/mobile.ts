export function isMobile() {
  // we use sm: as the breakpoint for mobile. It's currently set to 768px
  return globalThis.innerWidth < 760;
}
