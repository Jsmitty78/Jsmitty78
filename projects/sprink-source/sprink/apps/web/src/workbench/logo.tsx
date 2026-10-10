import wordmark from "./assets/sprink-wordmark.png";

/** Sprink sprinkler-head mark, redrawn as vector from the brand artwork so it stays sharp at any size. */
export function SprinkMark({ size = 28 }: { size?: number }) {
  return <svg className="fa-mark" width={size} height={size} viewBox="-50 0 340 340" aria-hidden="true">
    <g fill="currentColor"><rect x="55" y="4" width="130" height="48" rx="8" /><rect x="92" y="48" width="56" height="80" />
      <path fillRule="evenodd" d="M42 184A78 78 0 0 1 198 184ZM84 184A36 36 0 0 1 156 184Z" /><rect x="15" y="182" width="210" height="36" rx="18" /></g>
    <path d="M53 252 20 296M120 252V322M187 252 220 296" stroke="currentColor" strokeWidth="34" strokeLinecap="round" fill="none" />
  </svg>;
}

/** Mark plus the "sprink" wordmark (raster from the supplied logo). */
export function SprinkLogo({ height = 26 }: { height?: number }) {
  return <span className="fa-logo-lockup" role="img" aria-label="Sprink"><SprinkMark size={height} /><img src={wordmark} alt="" height={Math.round(height * 0.8)} /></span>;
}
