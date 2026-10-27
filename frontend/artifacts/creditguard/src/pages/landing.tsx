import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  animate,
  motion,
  MotionConfig,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  type Variants,
} from "framer-motion";
import { signInDemo } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { CreditGuardMark } from "@/components/layout/Sidebar";

// Public page. Every statement here is something the product actually does;
// figures in the example are Bharat Forge Ltd's published FY26 consolidated
// numbers, labelled as such. No invented customers, savings or speed claims.

const EASE = [0.22, 1, 0.36, 1] as const; // ease-out-quint

const STEPS = [
  {
    title: "Data room",
    body: "Enter the borrower's NSE/BSE symbol. Five years of consolidated statements, quarterly results, shareholding and listed peers are fetched, and the latest annual report is read for ratings, borrowings, contingent liabilities, related-party transactions, auditor remarks and the group structure.",
    tags: ["Screener statements", "BSE annual report", "Listed peers"],
  },
  {
    title: "Draft",
    body: "A 21-section memorandum is drafted: CMA spread with conservative projections, DSCR on a stated basis, repayment schedule, sensitivity tests, covenant testing and a group organogram. Figures come from the data; the language model writes the commentary around them.",
    tags: ["CMA spread", "DSCR", "Sensitivity", "Organogram"],
  },
  {
    title: "Review",
    body: "Anything not in public filings (purpose, security, lenders, CIBIL, account conduct) is marked “RM to provide” and listed before sanction. The RM reviews and edits each section, records mitigations against risk flags, then submits for credit review.",
    tags: ["RM to provide", "Risk flags", "Section edits"],
  },
  {
    title: "Export",
    body: "The approved memorandum exports as a PDF with sources and an audit trail of who generated, edited and reviewed it.",
    tags: ["PDF", "Sources", "Audit trail"],
  },
];

const LIMITS = [
  "It does not make credit decisions. The recommendation is a draft for the RM and credit officer to author.",
  "Public data is not audited data. Each figure carries its source; verify against audited statements before sanction.",
  "Borrowers without listed filings need their statements uploaded; the public-data steps do not apply to them.",
];

/* ─────────────────────────── shared pieces ─────────────────────────── */

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Indian-grouped rupee crore, e.g. 16812 -> "₹16,812 Cr". */
const crore = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")} Cr`;

function CountUp({ to, format, run, delay = 0 }: { to: number; format: (n: number) => string; run: boolean; delay?: number }) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!run) return;
    if (reduce) { setValue(to); return; }
    const controls = animate(0, to, { duration: 1.1, delay, ease: EASE, onUpdate: setValue });
    return () => controls.stop();
  }, [run, to, delay, reduce]);
  return <>{format(value)}</>;
}

/* ───────────────────── hero: a memorandum assembling ───────────────────── */

const STATUS = ["Fetching sources", "Computing ratios", "Drafting commentary", "Draft ready for RM review"];
const SOURCES = [
  ["Statements, FY22 to FY26", "Screener.in"],
  ["Annual report FY2026", "BSE filing"],
  ["Listed peers", "Screener.in"],
] as const;
const FIGURES: { label: string; prev: string; to: number; format: (n: number) => string }[] = [
  { label: "Revenue", prev: "₹15,123 Cr", to: 16812, format: crore },
  { label: "EBITDA margin", prev: "17.8%", to: 17.4, format: (n) => `${n.toFixed(1)}%` },
  { label: "PAT", prev: "₹913 Cr", to: 1089, format: crore },
  { label: "Total debt / EBITDA", prev: "2.49x", to: 2.51, format: (n) => `${n.toFixed(2)}x` },
];
const DRAFT_LINE = "DSCR of 2.90x on a pro forma basis, including the proposed ₹250 Cr term loan.";
const LAST_STAGE = 5;

function MemoAssembly() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  // 0 nothing · 1 sources · 2 figures · 3 drafting · 4 flag · 5 done
  const [stage, setStage] = useState(reduce ? LAST_STAGE : 0);
  const [typed, setTyped] = useState(reduce ? DRAFT_LINE.length : 0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (reduce) { setStage(LAST_STAGE); setTyped(DRAFT_LINE.length); return; }
    if (!inView) return;
    setStage(0); setTyped(0);
    const t = [
      setTimeout(() => setStage(1), 350),
      setTimeout(() => setStage(2), 1700),
      setTimeout(() => setStage(3), 3100),
      setTimeout(() => setStage(4), 5300),
      setTimeout(() => setStage(5), 6100),
    ];
    return () => t.forEach(clearTimeout);
  }, [inView, reduce, run]);

  useEffect(() => {
    if (stage < 3 || typed >= DRAFT_LINE.length) return;
    const id = setTimeout(() => setTyped((n) => Math.min(DRAFT_LINE.length, n + 2)), 26);
    return () => clearTimeout(id);
  }, [stage, typed]);

  const status = STATUS[Math.min(STATUS.length - 1, Math.max(0, stage - 1))];
  const done = stage >= LAST_STAGE;

  return (
    <div ref={ref} className="relative">
      {/* A second sheet behind the memo: the case file has more than one page. */}
      <div aria-hidden="true" className="absolute inset-x-6 -bottom-3 top-6 rounded-xl bg-white/15" />
      <figure
        aria-label="Example: a credit appraisal memorandum for Bharat Forge Ltd being drafted"
        className="relative overflow-hidden rounded-xl bg-card text-card-foreground shadow-[0_30px_60px_-24px_rgb(6_24_36/0.55)]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-border px-5 py-3.5 sm:px-6">
          <CreditGuardMark className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-[13rem] flex-1">
            <div className="truncate text-[13px] font-semibold">Bharat Forge Ltd · Term loan ₹250 Cr</div>
            <div className="text-[11px] text-muted-foreground">Credit appraisal memorandum · example</div>
          </div>
          <div
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-500 ${
              done ? "bg-ok-bg text-ok" : "bg-muted text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {done ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
            )}
            <span className="max-w-[9rem] truncate sm:max-w-none">{stage === 0 ? "Opening case" : status}</span>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          {/* Sources */}
          <div>
            <div className="text-[11px] font-medium text-muted-foreground">Data room</div>
            <ul className="mt-2 space-y-1.5">
              {SOURCES.map(([what, where], i) => {
                const on = stage >= 1;
                return (
                  <motion.li
                    key={what}
                    initial={false}
                    animate={{ opacity: on ? 1 : 0.35 }}
                    transition={{ duration: 0.4, delay: on ? i * 0.28 : 0 }}
                    className="flex items-center gap-2.5 text-[13px]"
                  >
                    <motion.span
                      initial={false}
                      animate={{ scale: on ? 1 : 0.6, backgroundColor: on ? "hsl(150 39% 30%)" : "hsl(213 14% 86%)" }}
                      transition={{ duration: 0.35, delay: on ? i * 0.28 + 0.1 : 0, ease: EASE }}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white"
                    >
                      <Check className="h-2.5 w-2.5" />
                    </motion.span>
                    <span className="truncate">{what}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{where}</span>
                  </motion.li>
                );
              })}
            </ul>
          </div>

          {/* Figures */}
          <div>
            <div className="flex items-baseline text-[11px] font-medium text-muted-foreground">
              <span>Financial summary · consolidated</span>
              <span className="ml-auto w-[86px] text-right">FY25</span>
              <span className="w-[92px] text-right">FY26</span>
            </div>
            <table className="mt-1.5 w-full text-[13px] tabular-nums">
              <tbody>
                {FIGURES.map((f, i) => (
                  <motion.tr
                    key={f.label}
                    initial={false}
                    animate={{ opacity: stage >= 2 ? 1 : 0.3 }}
                    transition={{ duration: 0.4, delay: stage >= 2 ? i * 0.12 : 0 }}
                    className="border-t border-border/70"
                  >
                    <td className="py-1.5">{f.label}</td>
                    <td className="w-[86px] py-1.5 text-right text-muted-foreground">{f.prev}</td>
                    <td className="w-[92px] py-1.5 text-right font-semibold">
                      {stage >= 2 ? (
                        <CountUp key={run} to={f.to} format={f.format} run delay={i * 0.12} />
                      ) : (
                        <span className="ml-auto inline-block h-2.5 w-14 rounded bg-muted align-middle" aria-hidden="true" />
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Draft line */}
          <div className="rounded-lg bg-muted px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              Debt service
              <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-border">
                computed from statements
              </span>
            </div>
            <p className="mt-1.5 min-h-[2.75rem] font-serif text-[15px] leading-snug" aria-label={DRAFT_LINE}>
              <span aria-hidden="true">
                {DRAFT_LINE.slice(0, typed)}
                {stage >= 3 && typed < DRAFT_LINE.length && (
                  <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-primary" />
                )}
              </span>
            </p>
          </div>

          {/* RM flag */}
          <motion.div
            initial={false}
            animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 6 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="flex items-start gap-2.5 rounded-lg bg-warn-bg px-4 py-3 text-[13px] text-warn"
          >
            <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
            <span><span className="font-semibold">RM to provide:</span> security cover, existing lenders, CIBIL.</span>
          </motion.div>
        </div>

        <figcaption className="flex items-center gap-3 border-t border-border px-5 py-3 text-[11px] text-muted-foreground sm:px-6">
          <span>Published FY26 consolidated figures. Source: Screener.in, BSE annual report.</span>
          {!reduce && (
            <button
              type="button"
              onClick={() => setRun((r) => r + 1)}
              disabled={!done}
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 font-medium text-primary transition-opacity hover:underline disabled:opacity-0"
            >
              Replay
            </button>
          )}
        </figcaption>
      </figure>
    </div>
  );
}

/* ─────────────────── provenance: where a number comes from ─────────────────── */

const TRACE = [
  {
    who: "Filing",
    title: "Consolidated statements",
    line: "PAT FY26 ₹1,089 Cr · finance cost · depreciation · borrowings",
    note: "Fetched from Screener.in and the BSE annual report. Stored with its source.",
  },
  {
    who: "Calculation",
    title: "Deterministic ratios",
    line: "DSCR = (PAT + depreciation + interest) ÷ (interest + principal due)",
    note: "Computed in code on one stated basis. The language model never produces this number.",
  },
  {
    who: "Memorandum",
    title: "Commentary around the figure",
    line: "“DSCR of 2.90x on a pro forma basis, including the proposed ₹250 Cr term loan.”",
    note: "Written by the model from the computed value. Figures that disagree with the calculation are flagged.",
  },
];

function Provenance() {
  return (
    <section id="provenance" className="border-b border-border bg-card">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-8 lg:py-28">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.6 }}
          className="max-w-[60ch]"
        >
          <h2 className="text-[30px] leading-tight [text-wrap:balance] sm:text-[38px]">
            Where each number in the memorandum comes from
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
            Maths and language are kept apart. A credit officer can follow any figure from the filing to the sentence that cites it.
          </p>
        </motion.div>

        <ol className="relative mt-14 grid gap-6 lg:grid-cols-3 lg:gap-0">
          {/* Connector drawn across the row on wide screens */}
          <motion.span
            aria-hidden="true"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1.4, ease: EASE, delay: 0.2 }}
            className="absolute left-[27px] right-[calc(33.333%-47px)] top-[27px] hidden h-px origin-left bg-primary/40 lg:block"
          />
          {TRACE.map((t, i) => (
            <motion.li
              key={t.who}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.25 + i * 0.25 }}
              className="relative lg:px-5 first:lg:pl-0 last:lg:pr-0"
            >
              <div className="flex items-center gap-3">
                <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground ring-[6px] ring-card lg:h-[54px] lg:w-[54px]">
                  {i + 1}
                </span>
                <span className="relative z-10 -ml-3 bg-card pl-3 pr-3 text-[13px] font-semibold text-primary">{t.who}</span>
                {i < TRACE.length - 1 && <Arrow className="ml-auto h-4 w-4 rotate-90 text-primary/50 lg:hidden" />}
              </div>
              <div className="mt-5 rounded-xl border border-border bg-background/60 p-5">
                <h3 className="text-[17px] font-semibold">{t.title}</h3>
                <p className={`mt-3 rounded-md bg-card px-3 py-2.5 text-[13px] leading-relaxed ring-1 ring-border ${i === 2 ? "font-serif text-[14px]" : "font-mono"}`}>
                  {t.line}
                </p>
                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{t.note}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── how a case moves ───────────────────────── */

function Timeline() {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  return (
    <section id="how-it-works" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-8 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.6 }}
          className="lg:sticky lg:top-28 lg:self-start"
        >
          <h2 className="text-[30px] leading-tight [text-wrap:balance] sm:text-[38px]">How a case moves</h2>
          <p className="mt-4 max-w-[42ch] text-[16px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
            From a stock symbol to a memorandum ready for credit review, with the RM editing at every step.
          </p>
        </motion.div>

        <ol ref={ref} className="relative space-y-12 pl-12">
          <span aria-hidden="true" className="absolute bottom-2 left-[15px] top-2 w-[2px] rounded bg-border" />
          <motion.span
            aria-hidden="true"
            style={{ scaleY: progress }}
            className="absolute bottom-2 left-[15px] top-2 w-[2px] origin-top rounded bg-primary"
          />
          {STEPS.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, x: 16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.6, ease: EASE }}
              className="relative"
            >
              <span className="absolute -left-12 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-card text-[13px] font-semibold text-primary ring-2 ring-primary">
                {i + 1}
              </span>
              <h3 className="pt-0.5 text-[20px] font-semibold">{s.title}</h3>
              <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground [text-wrap:pretty]">{s.body}</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {s.tags.map((t) => (
                  <li key={t} className="rounded-full bg-card px-3 py-1 text-[12px] font-medium text-foreground ring-1 ring-border">
                    {t}
                  </li>
                ))}
              </ul>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const enterDemo = () => {
    if (loading) return;
    setLoading(true);
    signInDemo("demo@creditguard.ai");
    toast({ title: "You're in the demo workspace", description: "Cases here use public company data only." });
    setLocation("/");
  };

  const heroStagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-[100dvh] bg-background text-foreground">
        <header
          className={`fixed inset-x-0 top-0 z-30 transition-[background-color,box-shadow,color] duration-300 ${
            scrolled ? "bg-card/95 text-foreground shadow-[0_1px_0_hsl(var(--border))] backdrop-blur" : "bg-transparent text-white"
          }`}
        >
          <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-8">
            <span className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
              <CreditGuardMark className={`h-5 w-5 ${scrolled ? "text-primary" : "text-white"}`} /> CreditGuard
            </span>
            <nav className="ml-auto flex items-center gap-6 text-[13px]">
              <a href="#provenance" className={`hidden hover:underline sm:inline ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/80 hover:text-white"}`}>
                Sources
              </a>
              <a href="#how-it-works" className={`hidden hover:underline sm:inline ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/80 hover:text-white"}`}>
                How it works
              </a>
              <a href="#limits" className={`hidden hover:underline md:inline ${scrolled ? "text-muted-foreground hover:text-foreground" : "text-white/80 hover:text-white"}`}>
                Limits
              </a>
              <button
                type="button"
                onClick={enterDemo}
                disabled={loading}
                className={`inline-flex h-9 items-center rounded-md px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
                  scrolled ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-white text-primary hover:bg-white/90"
                }`}
              >
                <span className="sm:hidden">Open demo</span>
                <span className="hidden sm:inline">Open demo workspace</span>
              </button>
            </nav>
          </div>
        </header>

        <main>
          {/* Hero: committed teal */}
          <section className="relative overflow-hidden bg-primary text-primary-foreground">
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -right-[20%] -top-[30%] h-[80vmax] w-[80vmax] rounded-full bg-[radial-gradient(closest-side,hsl(190_70%_45%/0.35),transparent)]"
              animate={{ x: [0, -40, 0], y: [0, 30, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
            />

            <div className="relative mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-32 sm:px-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-16 lg:pb-28 lg:pt-40">
              <motion.div variants={heroStagger} initial="hidden" animate="show">
                <motion.p variants={fadeUp} className="text-[13px] font-medium text-white/80">
                  Credit appraisal for Indian commercial banks
                </motion.p>
                <motion.h1
                  variants={fadeUp}
                  className="mt-4 text-[38px] font-semibold leading-[1.08] tracking-[-0.025em] [text-wrap:balance] sm:text-[52px] lg:text-[58px]"
                >
                  Draft the CAM from filings, with every figure traced to its source.
                </motion.h1>
                <motion.p variants={fadeUp} className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-white/85 [text-wrap:pretty]">
                  CreditGuard reads a listed borrower's statements and annual report, drafts a 21-section memorandum
                  for the RM to edit, and lists what still has to be collected before sanction.
                </motion.p>
                <motion.div variants={fadeUp} className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <motion.button
                    type="button"
                    onClick={enterDemo}
                    disabled={loading}
                    whileHover={{ y: -2 }}
                    whileTap={{ y: 0, scale: 0.98 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="group inline-flex h-12 items-center gap-2 rounded-md bg-white px-5 text-[15px] font-semibold text-primary shadow-[0_6px_8px_-6px_rgb(0_0_0/0.35)] disabled:opacity-60"
                  >
                    {loading ? "Opening…" : "Open demo workspace"}
                    <Arrow className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </motion.button>
                  <a href="#provenance" className="text-[15px] font-medium text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
                    See where the numbers come from
                  </a>
                </motion.div>
                <motion.ul variants={fadeUp} className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/80">
                  {["Public company data only", "No customer data processed", "Every section editable"].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-white" /> {t}
                    </li>
                  ))}
                </motion.ul>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 28, rotate: -1.2 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                transition={{ duration: 1, ease: EASE, delay: 0.25 }}
              >
                <MemoAssembly />
              </motion.div>
            </div>
          </section>

          <Provenance />
          <Timeline />

          <section id="limits" className="border-t border-border bg-card">
            <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20 lg:py-24">
              <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.6 }}>
                <h2 className="text-[30px] leading-tight sm:text-[38px]">What it doesn't do</h2>
                <p className="mt-4 max-w-[40ch] text-[16px] leading-relaxed text-muted-foreground">
                  A memorandum is only as trustworthy as its sources. These limits are shown inside every case too.
                </p>
              </motion.div>
              <ul className="overflow-hidden rounded-xl border border-border">
                {LIMITS.map((l, i) => (
                  <motion.li
                    key={l}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.5, ease: EASE, delay: i * 0.1 }}
                    className="flex gap-4 border-t border-border bg-background/50 px-5 py-5 text-[15px] leading-relaxed first:border-t-0 sm:px-6"
                  >
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                    {l}
                  </motion.li>
                ))}
              </ul>
            </div>
          </section>

          {/* Closing call to action */}
          <section className="bg-foreground text-white">
            <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-8 px-4 py-16 sm:px-8 md:flex-row md:items-center md:justify-between lg:py-20">
              <div>
                <h2 className="text-[26px] font-semibold leading-tight sm:text-[32px]">Open a case on a listed borrower.</h2>
                <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-white/75">
                  The demo workspace uses public company data. Enter an NSE or BSE symbol and the data room fills itself.
                </p>
              </div>
              <motion.button
                type="button"
                onClick={enterDemo}
                disabled={loading}
                whileHover={{ y: -2 }}
                whileTap={{ y: 0, scale: 0.98 }}
                transition={{ duration: 0.2, ease: EASE }}
                className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-md bg-white px-5 text-[15px] font-semibold text-foreground disabled:opacity-60"
              >
                Open demo workspace
                <Arrow className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </motion.button>
            </div>
          </section>
        </main>

        <footer className="bg-foreground text-white/70">
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-6 text-xs sm:px-8">
            <span className="flex items-center gap-2 text-white"><CreditGuardMark className="h-4 w-4" /> CreditGuard</span>
            <span>© {new Date().getFullYear()} CreditGuard · Demo workspace · No customer data is processed.</span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
