type Tone = "success" | "warning" | "danger" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  neutral: "text-status-neutral",
};

export function StatPill({ count, label, tone }: { count: number; label: string; tone: Tone }) {
  return (
    <span className={`font-mono text-xs ${TONE_CLASSES[tone]}`}>
      {count} {label}
    </span>
  );
}
