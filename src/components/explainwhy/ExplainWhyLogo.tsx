import Image from "next/image";

/** Shared ExplainWhy mark and wordmark used across operations surfaces. */
export function ExplainWhyLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`explainwhy-logo${compact ? " explainwhy-logo-compact" : ""}`}>
      <Image className="explainwhy-logo-mark" src="/assets/Icon.svg" alt="" width={141} height={140} priority />
      {!compact ? <span className="explainwhy-logo-word">ExplainWhy</span> : <span className="sr-only">ExplainWhy Agent</span>}
    </span>
  );
}
