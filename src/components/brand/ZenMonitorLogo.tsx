/**
 * Zen Monitor logo — Radar + Z with infinite "echo" animation.
 *
 * The center disk holds the Z mark; three rings expand outward from it
 * non-stop, evoking a radar pinging the seller's cabinet.
 *
 * Usage:
 *   <ZenMonitorLogo size={32} />        // default emerald palette
 *   <ZenMonitorLogo size={48} muted />  // dim variant for hover states
 *   <ZenMonitorLogo size={24} animate={false} /> // static (e.g. screenshots)
 */
type ZenMonitorLogoProps = {
  /** Pixel size (rendered as both width and height). Defaults to 32. */
  size?: number;
  /** Disable echo animation (useful for screenshots or low-power preferences). */
  animate?: boolean;
  /** Optional aria-label override. */
  title?: string;
  /** Additional class for sizing/positioning the wrapper. */
  className?: string;
};

export function ZenMonitorLogo({
  size = 32,
  animate = true,
  title = 'Zen Monitor',
  className,
}: ZenMonitorLogoProps) {
  // Solid core + 3 echo rings (staggered phases).
  // Colors use Tailwind's emerald-500 (#10b981) so the mark matches the rest
  // of the brand without depending on theme tokens.
  const stroke = '#10b981';
  const fill = '#10b981';
  const markStroke = '#ffffff';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>

      {/* Echo rings — 3 phases, 0s / 0.8s / 1.6s offsets, 2.4s loop */}
      {animate && (
        <>
          <circle cx="32" cy="32" r="14" stroke={stroke} strokeWidth="2" fill="none">
            <animate attributeName="r" values="14;30;30" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx="32" cy="32" r="14" stroke={stroke} strokeWidth="2" fill="none">
            <animate attributeName="r" values="14;30;30" dur="2.4s" begin="0.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0" dur="2.4s" begin="0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="32" cy="32" r="14" stroke={stroke} strokeWidth="2" fill="none">
            <animate attributeName="r" values="14;30;30" dur="2.4s" begin="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0" dur="2.4s" begin="1.6s" repeatCount="indefinite" />
          </circle>
        </>
      )}

      {/* When animation disabled — keep 3 static rings so static use still reads "radar" */}
      {!animate && (
        <>
          <circle cx="32" cy="32" r="28" stroke={stroke} strokeWidth="2" opacity="0.25" />
          <circle cx="32" cy="32" r="20" stroke={stroke} strokeWidth="2" opacity="0.5" />
        </>
      )}

      {/* Core disk + Z mark — always on top, never animated so the brand stays stable */}
      <circle cx="32" cy="32" r="14" fill={fill} />
      <path
        d="M25 25 L39 25 L25 39 L39 39"
        stroke={markStroke}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default ZenMonitorLogo;
