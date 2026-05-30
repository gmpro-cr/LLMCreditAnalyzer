import { Link } from "wouter";
import { PiArrowLeftLight, PiWarningLight } from "react-icons/pi";

export default function NotFound() {
  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-background px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 mx-auto">
          <PiWarningLight className="h-7 w-7 text-muted-foreground/50" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">404</p>
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="text-sm text-muted-foreground font-light">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-4 transition-colors"
        >
          <PiArrowLeftLight className="h-4 w-4" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
