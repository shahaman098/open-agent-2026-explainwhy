import Image from "next/image";

/** Shared Normal mark and wordmark used across operations surfaces. */
export function NormalLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`normal-logo${compact ? " normal-logo-compact" : ""}`}>
      <Image className="normal-logo-mark" src="/assets/logo.svg" alt="" width={141} height={140} priority />
      {!compact ? <span className="normal-logo-word">normal</span> : <span className="sr-only">Normal</span>}
    </span>
  );
}
