interface LogoProps {
  style?: React.CSSProperties;
}

export function Logo({ style }: LogoProps) {
  return (
    <svg
      style={style}
      viewBox="0 0 412 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="lensdiff"
      role="img"
    >
      <rect x="0" y="0" width="100" height="100" rx="22" fill="#1b1f2a" />
      <circle cx="42" cy="42" r="24" fill="none" stroke="#ffffff" strokeWidth="6" />
      <line
        x1="59"
        y1="59"
        x2="76"
        y2="76"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect x="30" y="35" width="24" height="5" rx="2" fill="#ff7a6e" />
      <rect x="30" y="45" width="24" height="5" rx="2" fill="#5fd38c" />
      <text
        x="120"
        y="71"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="60"
        fontWeight="600"
        textLength="290"
        lengthAdjust="spacingAndGlyphs"
        fill="currentColor"
      >
        lensdiff
      </text>
    </svg>
  );
}
