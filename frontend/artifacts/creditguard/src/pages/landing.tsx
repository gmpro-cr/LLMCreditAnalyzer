import { Link } from "wouter";
import {
  PiSparkleLight,
  PiShieldCheckLight,
  PiEnvelopeSimpleLight,
  PiArrowRightLight,
  PiFileTextLight,
  PiRobotLight,
  PiCheckCircleLight,
} from "react-icons/pi";

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

const features = [
  {
    icon: PiSparkleLight,
    title: "12-section CAMs from real data",
    description:
      "Full credit appraisal memorandums grounded in actual filings, financials, and your data room — not templates.",
  },
  {
    icon: PiShieldCheckLight,
    title: "Risk flags with mitigations",
    description:
      "AI identifies and categorises credit risks with banker-grade mitigation commentary for each finding.",
  },
  {
    icon: PiEnvelopeSimpleLight,
    title: "Auto-fetch company data",
    description:
      "Pulls public filings automatically from BSE, NSE, and Investor Relations portals as the memo is generated.",
  },
];

const steps = [
  {
    number: "01",
    icon: PiFileTextLight,
    title: "Create a case",
    description:
      "Enter borrower details, facility type, and loan amount. Upload supporting documents to the data room.",
  },
  {
    number: "02",
    icon: PiRobotLight,
    title: "AI drafts the memo",
    description:
      "CreditGuard AI generates a complete 12-section CAM in under 5 minutes, grounded in real data.",
  },
  {
    number: "03",
    icon: PiCheckCircleLight,
    title: "Review and approve",
    description:
      "Edit each section, review flagged risks, and submit the memo through your approval workflow.",
  },
];

const stats = [
  { value: "12", label: "memo sections generated" },
  { value: "5 min", label: "average draft time" },
  { value: "80%", label: "reduction in manual effort" },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CreditGuardMark className="h-5 w-5 text-emerald-500 shrink-0" />
            <span className="font-semibold text-[15px] tracking-[-0.02em]">CreditGuard AI</span>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted transition-colors"
          >
            Sign in <PiArrowRightLight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-20">
        <div className="max-w-[640px]">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3.5 py-1.5 text-xs font-medium text-emerald-700 mb-8">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            AI-powered credit analysis
          </div>

          <h1 className="font-serif text-[3.2rem] sm:text-[4.2rem] font-medium leading-[1.06] tracking-[-0.03em] text-foreground mb-6">
            The AI co-pilot for credit appraisal memorandums.
          </h1>

          <p className="text-lg text-muted-foreground font-light leading-relaxed max-w-[500px] mb-10">
            Generate banker-grade CAMs from public filings, financials, and your data room — in minutes, not days. Built for relationship managers and credit analysts.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-150"
            >
              Enter demo workspace
              <PiArrowRightLight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-8 sm:gap-16">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5">
                <span className="font-display text-3xl tracking-tight text-foreground tabular">
                  {s.value}
                </span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12">
          <h2 className="font-serif text-[2rem] font-medium tracking-[-0.025em] text-foreground">
            Everything a credit analyst needs
          </h2>
          <p className="text-muted-foreground mt-2 text-sm font-light max-w-md">
            CreditGuard AI handles the research and drafting so analysts can focus on judgement, not data entry.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6 flex flex-col gap-5 hover:shadow-md transition-shadow duration-200"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/15 bg-emerald-500/8 text-emerald-600">
                <f.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-medium text-foreground mb-2 text-[0.9375rem]">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-12">
            <h2 className="font-serif text-[2rem] font-medium tracking-[-0.025em] text-foreground">
              From intake to memorandum in three steps
            </h2>
            <p className="text-muted-foreground mt-2 text-sm font-light max-w-md">
              A structured workflow that replaces days of manual research with minutes of AI-assisted drafting.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {steps.map((step, i) => (
              <div key={step.number} className="flex flex-col gap-4 relative">
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-5 left-[calc(100%_+_1.25rem)] right-[-1.25rem] h-px bg-border" />
                )}
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] font-semibold text-primary tracking-widest">
                    {step.number}
                  </span>
                  <div className="h-px flex-1 bg-border/60 max-w-[40px]" />
                </div>
                <step.icon className="h-6 w-6 text-muted-foreground/50" />
                <div>
                  <h3 className="font-semibold text-foreground mb-1.5">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
            <div className="max-w-md">
              <div className="h-px w-8 bg-emerald-400/50 mb-6" />
              <h2 className="font-serif text-[1.875rem] font-medium leading-tight tracking-[-0.02em] mb-3">
                Ready to cut memo time by 80%?
              </h2>
              <p className="text-sm text-sidebar-foreground/55 font-light leading-relaxed">
                No sign-up required. Explore a fully functional demo workspace with sample cases, AI memo generation, and risk analysis.
              </p>
            </div>
            <Link
              href="/login"
              className="shrink-0 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 active:scale-[0.98] transition-all duration-150"
            >
              Enter demo workspace
              <PiArrowRightLight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CreditGuardMark className="h-4 w-4 text-emerald-500" />
            <span className="text-xs font-medium text-foreground/70">CreditGuard AI</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} CreditGuard AI · Demo workspace · No real bank data is processed.
          </p>
        </div>
      </footer>
    </div>
  );
}
