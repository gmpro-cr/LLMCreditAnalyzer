import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  PiShieldCheckLight,
  PiSparkleLight,
  PiEnvelopeSimpleLight,
  PiSpinnerLight,
} from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { isAuthenticated, signInDemo } from "@/lib/auth";

function CreditGuardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 22" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 1L2 4.5v6C2 15.25 5.6 19.7 10 21c4.4-1.3 8-5.75 8-10.5v-6L10 1z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7 11.5l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) setLocation("/", { replace: true });
  }, [setLocation]);

  const onEnterDemo = async () => {
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 350));
    signInDemo("demo@creditguard.ai");
    toast({ title: "Welcome to CreditGuard AI", description: "You're in the demo workspace." });
    setLocation("/", { replace: true });
  };

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row bg-background">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[52%] bg-sidebar text-sidebar-foreground relative overflow-hidden">
        {/* Multi-layer gradient depth */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_-10%_-10%,_rgba(16,185,129,0.22),_transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_110%_110%,_rgba(99,102,241,0.12),_transparent_55%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-sidebar to-transparent" />

        <div className="relative z-10 flex flex-col justify-between w-full p-12">
          <div className="flex items-center gap-2.5">
            <CreditGuardMark className="h-5 w-5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-[15px] tracking-[-0.02em]">CreditGuard AI</span>
          </div>

          <div className="space-y-8 max-w-sm">
            <div className="space-y-4">
              <div className="h-px w-8 bg-emerald-400/60" />
              <h1 className="font-serif text-[2.4rem] font-medium leading-[1.12] tracking-[-0.03em] text-sidebar-foreground">
                The AI co-pilot for credit appraisal memorandums.
              </h1>
            </div>

            <p className="text-sm text-sidebar-foreground/65 leading-relaxed font-light">
              Generate banker-grade CAMs from public filings, financials, and your data room — in minutes, not days.
            </p>

            <ul className="space-y-3.5">
              {[
                { icon: PiSparkleLight, text: "12-section drafts grounded in real data" },
                { icon: PiShieldCheckLight, text: "Risk flags with suggested mitigations" },
                { icon: PiEnvelopeSimpleLight, text: "Auto-fetch from BSE / NSE / Investor Relations" },
              ].map((row) => (
                <li key={row.text} className="flex items-start gap-3.5">
                  <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/12 text-emerald-400 shrink-0 border border-emerald-500/15">
                    <row.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm text-sidebar-foreground/80 leading-snug pt-1">{row.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-sidebar-foreground/35 tracking-wide">
            © {new Date().getFullYear()} CreditGuard AI · Demo workspace
          </p>
        </div>
      </div>

      {/* Login form */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-[340px] space-y-7">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <CreditGuardMark className="h-5 w-5 text-emerald-500 shrink-0" />
            <span className="font-semibold text-[15px] tracking-[-0.02em]">CreditGuard AI</span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">Demo workspace</h2>
            <p className="text-sm text-muted-foreground font-light">
              No sign-up required. Explore a fully functional demo.
            </p>
          </div>

          <Button
            type="button"
            className="w-full h-11 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
            onClick={onEnterDemo}
            disabled={submitting}
          >
            {submitting ? (
              <><PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> Entering workspace…</>
            ) : (
              "Enter demo workspace"
            )}
          </Button>

          <p className="text-[11px] text-muted-foreground/60 text-center leading-relaxed">
            No real bank data is processed. Demo resets on sign-out.
          </p>
        </div>
      </div>
    </div>
  );
}

