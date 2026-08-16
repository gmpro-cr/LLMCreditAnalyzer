import { PiCloudSlashLight, PiArrowClockwiseLight } from "react-icons/pi";
import { Button } from "@/components/ui/button";

/**
 * Shown when a read failed because a backend dependency is unreachable.
 *
 * The point of this component is what it *prevents*: without it, a failed read
 * falls through to the empty branch and the UI reports "no cases" or a KPI of
 * 0. On a credit-appraisal tool that is a false statement about the portfolio,
 * not a cosmetic glitch. An outage must look like an outage.
 */
export function OutageState({
  title = "Can't reach the service",
  description = "Your data is safe — we just can't load it right now. This usually clears on its own in a few minutes.",
  onRetry,
  isRetrying = false,
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? "py-8" : "py-14"}`}
    >
      <PiCloudSlashLight className="h-10 w-10 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
          <PiArrowClockwiseLight className={`mr-2 h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}
