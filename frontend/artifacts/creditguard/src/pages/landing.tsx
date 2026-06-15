import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  PiSparkleLight,
  PiShieldCheckLight,
  PiEnvelopeSimpleLight,
  PiArrowRightLight,
  PiFileTextLight,
  PiRobotLight,
  PiCheckCircleLight,
  PiSpinnerLight,
  PiBuildingsLight,
} from "react-icons/pi";
import { signInDemo } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

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
      <path d="M7 11.5l2 2 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ease = [0.32, 0.72, 0, 1] as const;

function FadeUp({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.75, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const steps = [
  {
    number: "01",
    icon: PiFileTextLight,
    title: "Create a case",
    description: "Enter borrower details, facility type, and loan amount. Upload supporting documents to the data room.",
  },
  {
    number: "02",
    icon: PiRobotLight,
    title: "AI drafts the memo",
    description: "CreditGuard AI drafts all 12 CAM sections in parallel — a complete memo in under a minute, grounded in your data.",
  },
  {
    number: "03",
    icon: PiCheckCircleLight,
    title: "Review and approve",
    description: "Edit each section, review flagged risks, and submit the memo through your approval workflow.",
  },
];

const riskRows = [
  { label: "Leverage risk", level: "High", dot: "bg-red-500", text: "text-red-600" },
  { label: "Liquidity coverage", level: "Medium", dot: "bg-amber-500", text: "text-amber-600" },
  { label: "Sector concentration", level: "Low", dot: "bg-emerald-500", text: "text-emerald-600" },
];

/* Hero product visual — a believable slice of the CAM the engine produces.
   Emerald/amber/red here are semantic data colours, not brand accents. */
const spreadRows = [
  { metric: "Revenue (₹ Cr)", fy23: "412.6", fy24: "489.3", fy25: "547.1", trend: "up" },
  { metric: "EBITDA margin", fy23: "11.2%", fy24: "12.8%", fy25: "13.4%", trend: "up" },
  { metric: "DSCR", fy23: "1.42", fy24: "1.61", fy25: "1.78", trend: "up" },
  { metric: "Debt / Equity", fy23: "1.9x", fy24: "1.6x", fy25: "1.3x", trend: "down" },
];

const sectionChips = [
  { label: "Executive summary", done: true },
  { label: "Financial analysis", done: true },
  { label: "Industry outlook", done: true },
  { label: "Risk assessment", done: false },
];

function CamPreview() {
  return (
    <div className="relative" aria-hidden="true">
      {/* Main CAM card */}
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.85, delay: 0.3, ease }}
        className="rounded-2xl border border-border/80 bg-card shadow-[0_24px_60px_-18px_rgba(8,18,42,0.18)] overflow-hidden"
      >
        {/* Borrower header */}
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div>
            <p className="text-[13px] font-semibold text-foreground leading-tight">Tristar Polymers Ltd</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Working capital · ₹18.5 Cr · Speciality chemicals</p>
          </div>
          <span className="rounded-md bg-primary/8 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            CAM draft
          </span>
        </div>

        {/* Mini financial spread */}
        <div className="px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Financial spread</p>
            <p className="font-mono text-[10px] text-muted-foreground/70">audited · FY23–25</p>
          </div>
          <table className="w-full text-[11.5px] tabular">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                <th className="pb-1.5 text-left font-medium">Metric</th>
                <th className="pb-1.5 text-right font-medium">FY23</th>
                <th className="pb-1.5 text-right font-medium">FY24</th>
                <th className="pb-1.5 text-right font-medium">FY25</th>
              </tr>
            </thead>
            <tbody>
              {spreadRows.map((r) => (
                <tr key={r.metric} className="border-t border-border/50">
                  <td className="py-1.5 pr-2 text-muted-foreground">{r.metric}</td>
                  <td className="py-1.5 text-right font-mono text-foreground/70">{r.fy23}</td>
                  <td className="py-1.5 text-right font-mono text-foreground/70">{r.fy24}</td>
                  <td className="py-1.5 text-right font-mono font-semibold text-foreground">{r.fy25}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Section status chips */}
        <div className="flex flex-wrap gap-1.5 border-t border-border/70 bg-muted/40 px-5 py-3.5">
          {sectionChips.map((c) => (
            <span
              key={c.label}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-medium ${
                c.done
                  ? "bg-emerald-500/10 text-emerald-700"
                  : "bg-primary/8 text-primary"
              }`}
            >
              {c.done ? (
                <PiCheckCircleLight className="h-3 w-3" />
              ) : (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              )}
              {c.label}
              {!c.done && "…"}
            </span>
          ))}
        </div>
      </motion.div>

      {/* Floating risk panel */}
      <motion.div
        initial={{ opacity: 0, y: 24, rotate: 0 }}
        animate={{ opacity: 1, y: 0, rotate: -1.5 }}
        transition={{ duration: 0.85, delay: 0.5, ease }}
        className="absolute -bottom-10 -left-6 w-[240px] rounded-xl border border-border/80 bg-card p-3.5 shadow-[0_18px_44px_-14px_rgba(8,18,42,0.22)]"
      >
        <div className="mb-2 flex items-center gap-2">
          <PiShieldCheckLight className="h-3.5 w-3.5 text-primary" />
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Risk flags</p>
        </div>
        <div className="divide-y divide-border/60">
          {riskRows.map((r) => (
            <div key={r.label} className="flex items-center justify-between py-1.5 text-[11px]">
              <span className="text-muted-foreground">{r.label}</span>
              <span className={`flex items-center gap-1.5 font-semibold ${r.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
                {r.level}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Floating citation chip */}
      <motion.div
        initial={{ opacity: 0, y: -14, rotate: 0 }}
        animate={{ opacity: 1, y: 0, rotate: 1.25 }}
        transition={{ duration: 0.8, delay: 0.66, ease }}
        className="absolute -top-5 right-4 flex items-center gap-2 rounded-full border border-border/80 bg-card px-3 py-1.5 shadow-[0_10px_28px_-10px_rgba(8,18,42,0.2)]"
      >
        <PiBuildingsLight className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10.5px] font-medium text-muted-foreground">Source: BSE filing · FY25 annual report</span>
      </motion.div>
    </div>
  );
}

export default function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleDemo = async () => {
    if (loading) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 420));
    signInDemo("demo@creditguard.ai");
    toast({ title: "Welcome to CreditGuard AI", description: "You're in the demo workspace." });
    setLocation("/");
  };

  return (
    <div className="min-h-dvh bg-background text-foreground overflow-x-hidden">

      {/* ── Floating island nav ──────────────────────────────────────────── */}
      <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-5 pointer-events-none">
        <motion.nav
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease }}
          className="pointer-events-auto flex items-center justify-between gap-6 w-full max-w-xl rounded-full border border-border/60 bg-background/90 px-4 py-2 shadow-[0_2px_20px_rgba(8,18,42,0.07)] backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 pl-1">
            <CreditGuardMark className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-[13.5px] tracking-[-0.02em]">CreditGuard AI</span>
          </div>
          <div className="hidden sm:flex items-center gap-5">
            <a href="#features" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-200">Features</a>
            <a href="#how-it-works" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-200">How it works</a>
          </div>
          <button
            onClick={handleDemo}
            disabled={loading}
            className="group flex items-center gap-2 rounded-full bg-primary pl-4 pr-1.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/90 active:scale-[0.97] disabled:opacity-60"
          >
            {loading ? "Entering…" : "Enter demo"}
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-foreground/15 transition-transform duration-300 group-hover:translate-x-0.5">
              {loading
                ? <PiSpinnerLight className="h-3 w-3 animate-spin" />
                : <PiArrowRightLight className="h-3 w-3" />
              }
            </span>
          </button>
        </motion.nav>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[96dvh] flex items-center">
        {/* Ambient blobs — GPU-safe, fixed pseudo-elements */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-32 right-0 h-[520px] w-[520px] rounded-full bg-primary/[0.06] blur-3xl" />
          <div className="absolute top-2/3 -left-48 h-[420px] w-[420px] rounded-full bg-primary/[0.04] blur-3xl" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-6 pt-32 pb-24">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">

            {/* ── Left: copy ── */}
            <div>
              {/* Eyebrow */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.05, ease }}
                className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3.5 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.18em] text-primary"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                AI-powered credit analysis
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75, delay: 0.12, ease }}
                className="font-serif text-[clamp(2.75rem,4.8vw,4.25rem)] font-medium leading-[1.06] tracking-[-0.03em] text-foreground"
              >
                The AI co-pilot for credit appraisal.
              </motion.h1>

              {/* Subtext */}
              <motion.p
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.22, ease }}
                className="mt-6 max-w-[520px] text-[1.05rem] font-light leading-relaxed text-muted-foreground"
              >
                Generate banker-grade credit appraisal memorandums from public filings, financials, and your data room — in seconds, not days. Built for relationship managers and credit analysts.
              </motion.p>

              {/* CTA row */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, delay: 0.32, ease }}
                className="mt-9 flex flex-wrap items-center gap-4"
              >
                {/* Primary — Button-in-button */}
                <button
                  onClick={handleDemo}
                  disabled={loading}
                  className="group flex items-center gap-3 rounded-full bg-primary pl-6 pr-2 py-2 text-[15px] font-medium text-primary-foreground shadow-[0_2px_14px_rgba(4,112,255,0.28)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/90 hover:shadow-[0_4px_20px_rgba(4,112,255,0.36)] active:scale-[0.98] disabled:opacity-60"
                >
                  {loading ? "Entering workspace…" : "Enter demo workspace"}
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-foreground/15 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px">
                    {loading
                      ? <PiSpinnerLight className="h-4 w-4 animate-spin" />
                      : <PiArrowRightLight className="h-4 w-4" />
                    }
                  </span>
                </button>

                {/* Ghost */}
                <a
                  href="#how-it-works"
                  className="text-[15px] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
                >
                  See how it works →
                </a>
              </motion.div>
            </div>

            {/* ── Right: product preview ── */}
            <div className="hidden lg:block lg:pl-4">
              <CamPreview />
            </div>
          </div>

          {/* Stats strip */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.44, ease }}
            className="mt-20 flex flex-wrap gap-x-12 gap-y-5 border-t border-border/60 pt-10"
          >
            {[
              { value: "12", suffix: "", label: "CAM sections, each backed by citations" },
              { value: "15", suffix: " sec", label: "from borrower intake to first full draft" },
              { value: "80", suffix: "%", label: "less manual effort per memo vs spreadsheets" },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5">
                <span className="font-display text-[2.25rem] leading-none tracking-[-0.03em] tabular text-foreground">
                  {s.value}<span className="text-[1.5rem] text-muted-foreground">{s.suffix}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Bento feature grid ───────────────────────────────────────────── */}
      <section id="features" className="py-28 px-6">
        <div className="mx-auto max-w-5xl">
          <FadeUp className="mb-14">
            <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Capabilities</p>
            <h2 className="font-serif text-[2.6rem] font-medium leading-[1.1] tracking-[-0.025em] text-foreground max-w-sm">
              Everything a credit analyst needs
            </h2>
          </FadeUp>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5 auto-rows-[minmax(200px,auto)]">

            {/* ── Large card: 12-section CAMs (spans 3 cols) */}
            <FadeUp delay={0.05} className="md:col-span-3">
              <div className="h-full p-1.5 rounded-[1.625rem] bg-primary/[0.04] ring-1 ring-primary/[0.09]">
                <div className="h-full rounded-[calc(1.625rem-6px)] bg-card p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)] flex flex-col justify-between gap-8 min-h-[200px]">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/9 text-primary">
                    <PiSparkleLight className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="mb-2 text-[1.0625rem] font-semibold text-foreground">12-section CAMs from real data</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Full credit appraisal memorandums grounded in actual filings, financials, and your data room — not templates. Every section backed by verifiable citations.
                    </p>
                  </div>
                </div>
              </div>
            </FadeUp>

            {/* ── Tall card: Risk flags (spans 2 cols, 2 rows) */}
            <FadeUp delay={0.1} className="md:col-span-2 md:row-span-2">
              <div className="h-full p-1.5 rounded-[1.625rem] bg-muted/60 ring-1 ring-border/80">
                <div className="h-full rounded-[calc(1.625rem-6px)] bg-card p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)] flex flex-col gap-7 min-h-[420px]">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/9 text-primary">
                    <PiShieldCheckLight className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="mb-2 text-[1.0625rem] font-semibold text-foreground">Risk flags with mitigations</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      AI identifies and categorises credit risks with banker-grade mitigation commentary for each finding. Colour-coded severity levels for instant triage.
                    </p>
                  </div>
                  {/* Visual: risk indicator rows */}
                  <div className="mt-auto rounded-xl border border-border/70 bg-background/60 divide-y divide-border/60 overflow-hidden">
                    {riskRows.map((r) => (
                      <div key={r.label} className="flex items-center justify-between px-3.5 py-2.5 text-[11.5px]">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className={`flex items-center gap-1.5 font-semibold ${r.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
                          {r.level}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </FadeUp>

            {/* ── Bottom left: Auto-fetch (spans 3 cols) */}
            <FadeUp delay={0.15} className="md:col-span-3">
              <div className="h-full p-1.5 rounded-[1.625rem] bg-muted/60 ring-1 ring-border/80">
                <div className="h-full rounded-[calc(1.625rem-6px)] bg-card p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)] flex flex-col justify-between gap-7 min-h-[200px]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground/60">
                      <PiEnvelopeSimpleLight className="h-5 w-5" />
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      {["BSE", "NSE", "SEBI"].map((src) => (
                        <span key={src} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {src}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-[1.0625rem] font-semibold text-foreground">Auto-fetch company data</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Pulls public filings automatically from BSE, NSE, and Investor Relations portals. No more manual copying from SEBI portals and annual reports.
                    </p>
                  </div>
                </div>
              </div>
            </FadeUp>

          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-t border-border bg-card py-28 px-6">
        <div className="mx-auto max-w-5xl">
          <FadeUp className="mb-16">
            <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Process</p>
            <h2 className="font-serif text-[2.6rem] font-medium leading-[1.1] tracking-[-0.025em] text-foreground max-w-lg">
              From borrower intake to complete memorandum
            </h2>
          </FadeUp>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {steps.map((step, i) => (
              <FadeUp key={step.number} delay={i * 0.1} className="relative">
                {/* Connecting line on desktop */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-[22px] left-[calc(100%+0.5rem)] right-[-0.5rem] h-px bg-border" />
                )}
                <div className="mb-5 flex items-center gap-3">
                  <span className="font-mono text-[10.5px] font-bold tracking-[0.2em] text-primary">{step.number}</span>
                  <div className="h-px w-8 bg-border/80" />
                </div>
                <step.icon className="mb-4 h-5 w-5 text-muted-foreground/50" />
                <h3 className="mb-2 font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA dark band — deep navy in the site's cool-gray family ─────── */}
      <section className="bg-[hsl(218,40%,10%)] text-[hsl(210,40%,98%)]">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <FadeUp>
            <div className="mb-6 h-px w-10 bg-primary/60" />
            <h2 className="font-serif text-[2.25rem] font-medium leading-[1.1] tracking-[-0.025em] mb-4 max-w-md">
              Ready to cut memo time by 80%?
            </h2>
            <p className="mb-10 max-w-md text-sm font-light leading-relaxed text-[hsl(210,40%,98%)]/55">
              No sign-up required. Explore a fully functional demo workspace with sample cases, AI memo generation, and risk analysis tools.
            </p>
            <button
              onClick={handleDemo}
              disabled={loading}
              className="group flex items-center gap-3 rounded-full bg-primary pl-6 pr-2 py-2.5 text-[15px] font-medium text-primary-foreground shadow-[0_2px_16px_rgba(4,112,255,0.30)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/90 hover:shadow-[0_4px_22px_rgba(4,112,255,0.40)] active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? "Entering workspace…" : "Enter demo workspace"}
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px">
                {loading
                  ? <PiSpinnerLight className="h-4 w-4 animate-spin" />
                  : <PiArrowRightLight className="h-4 w-4" />
                }
              </span>
            </button>
          </FadeUp>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CreditGuardMark className="h-4 w-4 text-primary" />
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
