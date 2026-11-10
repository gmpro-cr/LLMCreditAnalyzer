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

const LIMITS: [string, string][] = [
  ["It does not make credit decisions.", "The recommendation is a draft for the RM and credit officer to author."],
  ["Public data is not audited data.", "Each figure carries its source; verify against audited statements before sanction."],
  ["Unlisted borrowers need their statements uploaded.", "The public-data steps do not apply to borrowers without listed filings."],
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

// Bharat Forge Ltd, consolidated, as computed in CreditGuard's own draft for the
// ₹250 Cr term-loan example. The sentence is quoted from that draft.
const YEARS = ["FY22", "FY23", "FY24", "FY25", "FY26"];
const RATIOS = {
  debt: { label: "Total debt / EBITDA", series: [3.01, 4.21, 3.1, 2.49, 2.51], limit: 3.5, test: "Covenant ≤ 3.50x", higherIsBetter: false },
  dscr: { label: "DSCR, pro forma", series: [3.12, 1.95, 2.25, 2.71, 2.9], limit: 1.25, test: "Benchmark ≥ 1.25x", higherIsBetter: true },
  icr: { label: "Interest coverage", series: [12.39, 5.81, 5.22, 6.46, 9.03], limit: 2, test: "Covenant ≥ 2.00x", higherIsBetter: true },
} as const;
type RatioKey = keyof typeof RATIOS;
type Hot = "debt" | "ebitda" | "ratio" | null;

function Ref({ k, hot, setHot, children, className = "" }: { k: Exclude<Hot, null>; hot: Hot; setHot: (h: Hot) => void; children: React.ReactNode; className?: string }) {
  const on = hot === k;
  return (
    <span
      tabIndex={0}
      onMouseEnter={() => setHot(k)}
      onMouseLeave={() => setHot(null)}
      onFocus={() => setHot(k)}
      onBlur={() => setHot(null)}
      className={`cursor-default rounded-[4px] px-1 py-px outline-none transition-[background-color,box-shadow,color] duration-200 ${
        on ? "bg-[hsl(195_70%_62%/0.22)] text-white shadow-[0_0_0_1px_hsl(195_70%_62%/0.7)]" : "bg-white/[0.06] shadow-[0_0_0_1px_rgb(255_255_255/0.12)]"
      } ${className}`}
    >
      {children}
    </span>
  );
}

function RatioChart({ which, hot, setHot }: { which: RatioKey; hot: Hot; setHot: (h: Hot) => void }) {
  const r = RATIOS[which];
  const max = Math.max(...r.series, r.limit) * 1.15;
  const W = 340, H = 176, base = 148, top = 16, slot = W / r.series.length, bw = 28;
  const y = (v: number) => base - ((base - top) * v) / max;
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-2"><span className="h-0 w-5" style={{ borderTop: "1.5px dashed hsl(40 92% 64%)" }} />{r.test}</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(195_70%_62%)]" />{r.label}, FY26</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${r.label}, ${YEARS[0]} to ${YEARS[4]}: ${r.series.map((v, i) => `${YEARS[i]} ${v.toFixed(2)}x`).join(", ")}. ${r.test}.`}>
        <line x1="0" x2={W} y1={base} y2={base} stroke="rgb(255 255 255 / 0.18)" />
        <line x1="0" x2={W} y1={y(r.limit)} y2={y(r.limit)} stroke="hsl(40 92% 64%)" strokeWidth="1.25" strokeDasharray="4 4" />
        {r.series.map((v, i) => {
          const x = slot * i + (slot - bw) / 2;
          const latest = i === r.series.length - 1;
          const lit = latest ? which === "debt" && hot === "ratio" : false;
          const breach = r.higherIsBetter ? v < r.limit : v > r.limit;
          const show = latest || breach || focus === i;
          return (
            <g key={i} onMouseEnter={() => { setFocus(i); if (latest && which === "debt") setHot("ratio"); }} onMouseLeave={() => { setFocus(null); if (latest) setHot(null); }}>
              <rect x={slot * i} y={top} width={slot} height={base - top + 20} fill="transparent" />
              <motion.path
                initial={false}
                animate={{ d: `M${x},${base} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${base} Z` }}
                transition={{ duration: 0.6, ease: EASE }}
                fill={breach ? "hsl(40 92% 64%)" : latest ? "hsl(195 70% 62%)" : "hsl(195 70% 62% / 0.38)"}
                stroke={lit ? "white" : "none"}
                strokeWidth="1.5"
              />
              {show && (
                <text x={x + bw / 2} y={y(v) - 8} textAnchor="middle" className="fill-white text-[12px] font-semibold tabular-nums">
                  {v.toFixed(2)}x
                </text>
              )}
              <text x={x + bw / 2} y={base + 16} textAnchor="middle" className="fill-[hsl(203_32%_78%)] text-[11px]">{YEARS[i]}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Provenance() {
  const [hot, setHot] = useState<Hot>(null);
  const [which, setWhich] = useState<RatioKey>("debt");
  return (
    <section id="provenance" className="on-ink relative overflow-hidden bg-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_26rem_at_100%_0%,hsl(196_83%_28%/0.55),transparent_70%)]" />
      <div className="relative mx-auto max-w-[1200px] px-4 py-20 sm:px-8 lg:py-28">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
          <h2 className="text-[32px] leading-[1.1] [text-wrap:balance] sm:text-[44px]">
            Every figure can be followed back to the filing it came from.
          </h2>
          <p className="max-w-[52ch] text-[16px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
            Ratios are computed in code on one stated basis. The language model only writes the sentence around them, and a sentence that disagrees with the calculation is flagged.
            <span className="mt-2 block text-[13px]">Point at a number to see where it goes.</span>
          </p>
        </div>

        <div className="mt-12 grid overflow-hidden rounded-2xl bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] lg:grid-cols-[1fr_1fr_1.15fr]">
          <div className="border-b border-white/10 p-6 lg:border-b-0 lg:border-r sm:p-7">
            <div className="text-[13px] font-semibold text-[hsl(195_70%_62%)]">Filing</div>
            <p className="mt-1 text-[13px] text-muted-foreground">Consolidated statements, FY26 · Screener.in, BSE annual report</p>
            <dl className="mt-6 space-y-4 text-[15px]">
              <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-muted-foreground">Total debt</dt>
                <dd className="tabular-nums font-semibold"><Ref k="debt" hot={hot} setHot={setHot}>₹7,309 Cr</Ref></dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-3">
                <dt className="text-muted-foreground">EBITDA</dt>
                <dd className="tabular-nums font-semibold"><Ref k="ebitda" hot={hot} setHot={setHot}>₹2,917 Cr</Ref></dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 text-[13px] text-muted-foreground">
                <dt>Term debt and leases · working capital</dt>
                <dd className="tabular-nums">₹2,246 · ₹5,062 Cr</dd>
              </div>
            </dl>
          </div>

          <div className="border-b border-white/10 p-6 lg:border-b-0 lg:border-r sm:p-7">
            <div className="text-[13px] font-semibold text-[hsl(195_70%_62%)]">Calculation</div>
            <p className="mt-1 text-[13px] text-muted-foreground">Deterministic, in code. Never generated by the model.</p>
            <div className="mt-6 font-mono text-[15px] leading-loose tabular-nums">
              <Ref k="debt" hot={hot} setHot={setHot}>7,309</Ref>
              <span className="mx-2 text-muted-foreground">÷</span>
              <Ref k="ebitda" hot={hot} setHot={setHot}>2,917</Ref>
              <span className="mx-2 text-muted-foreground">=</span>
              <Ref k="ratio" hot={hot} setHot={setHot} className="font-semibold">2.51x</Ref>
            </div>
            <div className="mt-5 flex items-center gap-2 text-[13px]">
              <span className="chip bg-ok-bg text-ok">Complied</span>
              <span className="text-muted-foreground">against covenant ≤ 3.50x</span>
            </div>
          </div>

          <div className="p-6 sm:p-7">
            <div className="text-[13px] font-semibold text-[hsl(195_70%_62%)]">Memorandum</div>
            <p className="mt-1 text-[13px] text-muted-foreground">Leverage, Debt Profile &amp; Debt Servicing · section 9 of 21</p>
            <blockquote className="mt-6 font-serif text-[19px] leading-[1.55] text-white">
              “The total debt-to-EBITDA ratio improved to <Ref k="ratio" hot={hot} setHot={setHot} className="font-semibold">2.51x</Ref> in FY26 from 3.10x in FY24.”
            </blockquote>
          </div>
        </div>

        <div className="mt-6 grid gap-6 rounded-2xl bg-white/[0.04] p-6 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] sm:p-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-12">
          <div>
            <h3 className="text-[19px] font-semibold">Five years on the same basis</h3>
            <p className="mt-2 max-w-[44ch] text-[14px] leading-relaxed text-muted-foreground">
              The draft tests each ratio against its covenant for every year, so a credit officer sees the trend, not one flattering number. A breached year is marked in amber.
            </p>
            <div role="tablist" aria-label="Ratio" className="mt-5 inline-flex flex-wrap gap-1 rounded-lg bg-white/[0.06] p-1">
              {(Object.keys(RATIOS) as RatioKey[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={which === k}
                  onClick={() => setWhich(k)}
                  className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${which === k ? "bg-white font-medium text-[hsl(212_43%_13%)]" : "text-muted-foreground hover:text-white"}`}
                >
                  {RATIOS[k].label}
                </button>
              ))}
            </div>
          </div>
          <RatioChart which={which} hot={hot} setHot={setHot} />
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground">Example: Bharat Forge Ltd, consolidated, from CreditGuard's draft for a ₹250 Cr term loan. Published figures; not audited by CreditGuard.</p>
      </div>
    </section>
  );
}

/* ───────────────────────── the memorandum it drafts ───────────────────────── */

// Section order and titles as produced by the engine (python-service/cam_v2.py).
const CONTENTS: [string, boolean][] = [
  ["Executive Summary", true], ["Proposal & Facility Structure", true], ["Company & Business Profile", true],
  ["Group Structure", true], ["Shareholding, Board & Management", true], ["Industry Outlook", true],
  ["Financial Analysis — Summary", true], ["Revenue & Profitability", true], ["Leverage, Debt Profile & Debt Servicing", true],
  ["Liquidity & Working Capital", true], ["Interim Performance", true], ["Assessment of Facilities & Sensitivity", true],
  ["Banking Arrangement & Credit Ratings", true], ["Contingent Liabilities, Related Parties & Audit", true], ["Peer Comparison", true],
  ["Due Diligence & Hygiene Checks", true], ["Key Risks & Mitigants", true], ["Recommendation, Terms & Covenants", true],
  ["EWS Checklist", false], ["Reference Check", false], ["Information Required from RM", false],
];

function Contents() {
  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16 lg:py-28">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="text-[32px] leading-[1.1] [text-wrap:balance] sm:text-[44px]">The whole memorandum, in the bank's order.</h2>
          <p className="mt-5 max-w-[44ch] text-[16px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
            Twenty-one sections, from the executive summary to the list of what the RM still has to collect. Each section is drafted from the case's data, then edited, reviewed and locked by the RM.
          </p>
          <dl className="mt-8 flex gap-8 text-[13px]">
            <div><dt className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" />Drafted with commentary</dt><dd className="mt-1 font-serif text-[28px] font-semibold tabular-nums">18</dd></div>
            <div><dt className="flex items-center gap-2 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-warn" />Checklists for the RM</dt><dd className="mt-1 font-serif text-[28px] font-semibold tabular-nums">3</dd></div>
          </dl>
        </div>

        <div className="relative">
          <div aria-hidden="true" className="absolute inset-x-5 -bottom-3 top-4 rounded-2xl bg-card/70 shadow-sm" />
          <div className="relative rounded-2xl bg-card px-6 py-7 shadow-lg sm:px-10 sm:py-9">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
              <div>
                <div className="font-serif text-[20px] font-semibold">Credit Appraisal Memorandum</div>
                <div className="text-[12px] text-muted-foreground">Contents</div>
              </div>
              <span className="chip bg-accent text-accent-foreground">Draft for RM review</span>
            </div>
            <ol className="mt-4 gap-x-10 sm:columns-2">
              {CONTENTS.map(([title, drafted], i) => (
                <li key={title} className="flex break-inside-avoid items-baseline gap-3 border-b border-border/60 py-2.5 text-[14px]">
                  <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 leading-snug">{title}</span>
                  <span aria-label={drafted ? "drafted with commentary" : "checklist for the RM"} className={`h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full ${drafted ? "bg-primary" : "bg-warn"}`} />
                </li>
              ))}
            </ol>
          </div>
        </div>
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
                  <li key={t} className="rounded-md bg-card px-2.5 py-1 text-[12px] font-medium text-foreground shadow-xs">
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
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(70rem_40rem_at_85%_-10%,hsl(190_70%_40%/0.45),transparent_65%),radial-gradient(50rem_30rem_at_0%_110%,hsl(212_43%_13%/0.55),transparent_70%)]"
            />

            <div className="relative mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-32 sm:px-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-16 lg:pb-28 lg:pt-40">
              <motion.div variants={heroStagger} initial="hidden" animate="show">
                <motion.h1
                  variants={fadeUp}
                  className="text-[38px] font-semibold leading-[1.08] tracking-[-0.025em] [text-wrap:balance] sm:text-[52px] lg:text-[58px]"
                >
                  Draft the CAM from filings, with every figure traced to its source.
                </motion.h1>
                <motion.p variants={fadeUp} className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-white/85 [text-wrap:pretty]">
                  For Indian commercial banks. CreditGuard reads a listed borrower's statements and annual report, drafts a
                  21-section credit appraisal memorandum for the RM to edit, and lists what still has to be collected before sanction.
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
          <Contents />

          <section id="limits" className="bg-card">
            <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-8 lg:py-24">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <h2 className="text-[32px] leading-[1.1] sm:text-[44px]">What it doesn't do</h2>
                <p className="max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
                  A memorandum is only as trustworthy as its sources. These limits are shown inside every case too.
                </p>
              </div>
              <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-border md:grid-cols-3">
                {LIMITS.map(([lead, detail]) => (
                  <li key={lead} className="bg-card p-6 sm:p-7">
                    <p className="font-serif text-[20px] font-semibold leading-snug">{lead}</p>
                    <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Closing call to action */}
          <section className="relative overflow-hidden bg-primary text-white">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(50rem_24rem_at_100%_100%,hsl(190_70%_40%/0.5),transparent_70%)]" />
            <div className="relative mx-auto flex max-w-[1200px] flex-col items-start gap-8 px-4 py-16 sm:px-8 md:flex-row md:items-center md:justify-between lg:py-20">
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
                className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-md bg-white px-5 text-[15px] font-semibold text-primary shadow-[0_6px_8px_-6px_rgb(0_0_0/0.35)] disabled:opacity-60"
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
