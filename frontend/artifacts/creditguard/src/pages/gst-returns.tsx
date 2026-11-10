import { useMemo, useRef, useState } from "react";
import { PiUploadSimpleLight, PiFileXlsLight, PiSpinnerLight, PiDownloadSimpleLight, PiXLight, PiBankLight } from "react-icons/pi";
import { PageHeader, PageBody } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// ── Types (mirror python-service/gst_returns.py) ─────────────────────────────

type Severity = "high" | "medium" | "low";

interface MonthRow {
  month: string; label: string;
  taxable: number; zero_rated: number; exempt: number; non_gst: number; turnover: number;
  output_tax: number | null; itc: number | null; cash_paid: number | null;
  gross_sales: number; bank_credits: number | null;
}

interface GstResult {
  taxpayer: {
    legal_name: string | null; filename: string;
    gstin: null | { gstin: string; format_ok: boolean; state?: string; pan?: string; check_digit_ok?: boolean };
  };
  period: { from: string; to: string; months: number; missing_months: string[]; duplicate_months: string[] };
  totals: {
    turnover: number; taxable: number; zero_rated: number; exempt: number; non_gst: number;
    output_tax: number | null; itc: number | null; cash_paid: number | null; gross_sales: number;
    average_monthly_turnover: number; annualised_turnover: number;
  };
  ratios: {
    export_share_pct: number | null; exempt_share_pct: number | null; effective_tax_rate_pct: number | null;
    itc_to_output_pct: number | null; cash_share_of_tax_pct: number | null; volatility_pct: number | null;
  };
  trend: {
    growth: { basis: string; pct: number | null } | null;
    peak: { month: string; turnover: number }; trough: { month: string; turnover: number };
    nil_months: string[];
  };
  filing: {
    months_with_dates: number; late_count: number; max_delay_days: number; basis: string;
    items: { month: string; due: string; filed_on: string | null; delay_days: number | null }[];
  };
  concentration: null | {
    customers: number; top1_share_pct: number; top5_share_pct: number;
    top: { name: string; gstin: string | null; taxable_value: number; share_pct: number }[];
    others_value: number | null; others_share_pct: number | null;
  };
  reconciliation: {
    financials?: { financials_turnover: number; gst_turnover: number; variance_pct: number };
    bank?: { months_compared: number; period?: string; gst_gross_sales?: number; bank_credits?: number; ratio?: number | null; basis?: string; note?: string };
  };
  monthly: MonthRow[];
  flags: { severity: Severity; title: string; detail: string }[];
  observations: string[];
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Rupees -> "₹4.12 Cr" or "₹38.50 lakh" (Indian banking convention). */
function amt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
  return `${sign}₹${(a / 1e5).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lakh`;
}
/** One unit per table so a column can be scanned: crore when months run above ₹1 Cr, else lakh. */
function unitFor(typical: number) {
  return typical >= 1e7 ? { div: 1e7, label: "₹ crore" } : { div: 1e5, label: "₹ lakh" };
}
function num(n: number | null | undefined, div: number, blankZero = false): string {
  if (n === null || n === undefined || (blankZero && n === 0)) return "—";
  return (n / div).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "—" : `${n.toFixed(d)}%`);
const shortMonth = (label: string) => { const [m, y] = label.split(" "); return `${m} ’${y.slice(2)}`; };

const SEV: Record<Severity, { label: string; cls: string }> = {
  high: { label: "High", cls: "bg-risk-bg text-risk" },
  medium: { label: "Medium", cls: "bg-warn-bg text-warn" },
  low: { label: "Low", cls: "bg-muted text-muted-foreground" },
};

const API = import.meta.env.VITE_API_URL || "";

// ── Pieces ───────────────────────────────────────────────────────────────────

function FilePick({ label, hint, accept, file, onFile, icon }: {
  label: string; hint: string; accept: string; file: File | null; onFile: (f: File | null) => void; icon: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      {file ? (
        <div className="flex items-center gap-3 rounded-lg bg-accent/60 px-4 py-3 text-sm">
          <span className="text-primary">{icon}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
          <button type="button" onClick={() => onFile(null)} className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground" aria-label={`Remove ${file.name}`}>
            <PiXLight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          className={`flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-left text-sm transition-colors ${over ? "border-primary bg-accent/50" : "border-input hover:border-primary/60 hover:bg-muted/60"}`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary"><PiUploadSimpleLight className="h-4 w-4" /></span>
          <span><span className="font-medium text-foreground">Choose a file</span> <span className="text-muted-foreground">or drop it here</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
        </button>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "ok" | "warn" | "risk" }) {
  const toneCls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "risk" ? "text-risk" : "text-muted-foreground";
  return (
    <div className="px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-tight tabular-nums tracking-[-0.01em]">{value}</div>
      {note && <div className={`mt-0.5 text-xs ${toneCls}`}>{note}</div>}
    </div>
  );
}

function MonthlyChart({ rows, withBank }: { rows: MonthRow[]; withBank: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = rows.map((r) => ({ a: withBank ? r.gross_sales : r.turnover, b: withBank ? r.bank_credits : null }));
  const max = Math.max(1, ...series.flatMap((s) => [s.a, s.b ?? 0])) * 1.08;
  const H = 220, base = 196, top = 8;
  const slot = 100 / rows.length;
  const y = (v: number) => base - ((base - top) * Math.max(0, v)) / max;
  const label = withBank ? "GST gross sales (incl. tax)" : "Total outward supplies";
  const h = hover !== null ? rows[hover] : null;

  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />{label}</span>
        {withBank && <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[hsl(214_14%_62%)]" />Bank credits</span>}
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-[220px] w-full overflow-visible" role="img"
          aria-label={`${label} by month${withBank ? ", with bank credits" : ""}. See the monthly table for figures.`}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2="100" y1={base - (base - top) * f} y2={base - (base - top) * f} stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2="100" y1={base} y2={base} stroke="hsl(213 14% 72%)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {series.map((s, i) => {
            const x0 = slot * i;
            const bw = withBank ? slot * 0.3 : slot * 0.56;
            const gap = slot * 0.04;
            const xa = withBank ? x0 + slot / 2 - bw - gap / 2 : x0 + (slot - bw) / 2;
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} opacity={dim ? 0.45 : 1} style={{ transition: "opacity 150ms ease-out" }}>
                <rect x={xa} y={y(s.a)} width={bw} height={Math.max(0, base - y(s.a))} rx="0.6" className="fill-primary" />
                {withBank && s.b !== null && (
                  <rect x={xa + bw + gap} y={y(s.b)} width={bw} height={Math.max(0, base - y(s.b))} rx="0.6" fill="hsl(214 14% 62%)" />
                )}
                <rect x={x0} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        <div className="mt-1.5 flex text-[11px] text-muted-foreground">
          {rows.map((r, i) => (
            <span key={r.month} className="flex-1 text-center tabular-nums">
              {rows.length > 12 && i % 2 === 1 ? "" : shortMonth(r.label)}
            </span>
          ))}
        </div>
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-[200px] -translate-x-1/2 rounded-lg bg-[hsl(212_43%_13%)] px-3 py-2 text-xs text-white shadow-lg"
            style={{ left: `${Math.min(88, Math.max(12, slot * hover + slot / 2))}%` }}
          >
            <div className="font-medium">{h.label}</div>
            <div className="mt-1 flex justify-between gap-3"><span className="text-white/70">{withBank ? "GST gross sales" : "Outward supplies"}</span><span className="tabular-nums">{amt(withBank ? h.gross_sales : h.turnover)}</span></div>
            {withBank && <div className="flex justify-between gap-3"><span className="text-white/70">Bank credits</span><span className="tabular-nums">{amt(h.bank_credits)}</span></div>}
            {h.output_tax !== null && <div className="flex justify-between gap-3"><span className="text-white/70">Output tax</span><span className="tabular-nums">{amt(h.output_tax)}</span></div>}
          </div>
        )}
      </div>
    </figure>
  );
}

function ReconRow({ title, left, right, verdict, tone, note }: {
  title: string; left: [string, string]; right: [string, string]; verdict: string; tone: "ok" | "warn" | "risk"; note?: string;
}) {
  const chip = tone === "ok" ? "bg-ok-bg text-ok" : tone === "warn" ? "bg-warn-bg text-warn" : "bg-risk-bg text-risk";
  return (
    <div className="border-t border-border/70 px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{title}</div>
        <span className={`chip ${chip}`}>{verdict}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">{left[0]}</dt><dd className="mt-0.5 font-semibold tabular-nums">{left[1]}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{right[0]}</dt><dd className="mt-0.5 font-semibold tabular-nums">{right[1]}</dd></div>
      </dl>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GstReturns() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [legalName, setLegalName] = useState("");
  const [gstin, setGstin] = useState("");
  const [finCr, setFinCr] = useState("");
  const [busy, setBusy] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GstResult | null>(null);

  const pickGst = (f: File | null) => {
    if (f && !/\.(xlsx|xls|csv)$/i.test(f.name)) { toast({ title: "Unsupported file", description: "Upload the GST summary as Excel or CSV.", variant: "destructive" }); return; }
    setFile(f);
  };
  const pickBank = (f: File | null) => {
    if (f && !/\.(pdf|csv|xlsx|xls)$/i.test(f.name)) { toast({ title: "Unsupported file", description: "Bank statement must be PDF, CSV or Excel.", variant: "destructive" }); return; }
    setBankFile(f);
  };

  const downloadTemplate = async () => {
    setTemplating(true);
    try {
      const res = await fetch(`${API}/api/gst/template`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Template unavailable");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "CreditGuard_GST_summary_template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Couldn't download the template", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTemplating(false);
    }
  };

  const analyse = async () => {
    if (!file) { setError("Choose the GST summary file first."); return; }
    const fin = finCr.trim() ? Number(finCr.replace(/,/g, "")) : null;
    if (fin !== null && (!Number.isFinite(fin) || fin <= 0)) { setError("Turnover per financials must be a positive number in ₹ crore."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (bankFile) fd.append("bankFile", bankFile);
      if (legalName.trim()) fd.append("legalName", legalName.trim());
      if (gstin.trim()) fd.append("gstin", gstin.trim());
      if (fin !== null) fd.append("financialsTurnover", String(Math.round(fin * 1e7)));
      const res = await fetch(`${API}/api/gst/analyze`, { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Analysis failed. Please try again.");
      setResult(data as GstResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setResult(null); setError(null); setFile(null); setBankFile(null); };

  const withBank = !!result?.reconciliation.bank?.months_compared;
  const tableUnit = unitFor(result?.totals.average_monthly_turnover ?? 0);
  const custUnit = unitFor(result?.concentration?.top[0]?.taxable_value ?? 0);
  const sevCounts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    result?.flags.forEach((f) => { c[f.severity] += 1; });
    return c;
  }, [result]);

  return (
    <>
      <PageHeader
        title="GST returns"
        subtitle={result
          ? <>{result.taxpayer.legal_name || result.taxpayer.filename} · {result.period.from} to {result.period.to} · {result.period.months} month{result.period.months === 1 ? "" : "s"}</>
          : "Turnover, tax and filing record from the borrower's monthly GSTR-3B summary, checked against the financials and the bank statement."}
        actions={result ? <Button variant="outline" onClick={reset}>Analyse another summary</Button> : undefined}
      />
      <PageBody className="space-y-6">
        {!result ? (
          <section className="panel grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
            <div className="space-y-5 p-5 sm:p-7">
              <FilePick label="GST summary" hint="Excel or CSV, one row per month · up to 25 MB" accept=".xlsx,.xls,.csv" file={file} onFile={pickGst} icon={<PiFileXlsLight className="h-5 w-5" />} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="gst-name">Legal name</Label>
                  <Input id="gst-name" className="mt-1.5" placeholder="As registered on the GST portal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="gst-gstin">GSTIN</Label>
                  <Input id="gst-gstin" className="mt-1.5 font-mono uppercase placeholder:font-sans placeholder:normal-case" maxLength={15} placeholder="15 characters" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
                </div>
              </div>
              <div className="border-t border-border pt-5">
                <h2 className="font-sans text-sm font-semibold tracking-normal">Reconcile (optional)</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Both should cover the same months as the GST summary.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="gst-fin">Turnover per financials (₹ crore)</Label>
                    <Input id="gst-fin" inputMode="decimal" className="mt-1.5 tabular-nums" placeholder="e.g. 58.40" value={finCr} onChange={(e) => setFinCr(e.target.value)} />
                  </div>
                  <FilePick label="Bank statement" hint="PDF, CSV or Excel" accept=".pdf,.csv,.xlsx,.xls" file={bankFile} onFile={pickBank} icon={<PiBankLight className="h-5 w-5" />} />
                </div>
              </div>
              {error && <p className="rounded-lg bg-risk-bg px-4 py-3 text-sm text-risk" role="alert">{error}</p>}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button onClick={analyse} disabled={busy || !file} className="min-w-[180px]">
                  {busy ? <><PiSpinnerLight className="h-4 w-4 animate-spin" />Analysing…</> : "Analyse returns"}
                </Button>
                <span className="text-xs text-muted-foreground">Files are analysed in memory and not stored.</span>
              </div>
            </div>
            <aside className="border-t border-border bg-muted/50 p-5 sm:p-7 lg:border-l lg:border-t-0">
              <h2 className="font-sans text-sm font-semibold tracking-normal">What to upload</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                A month-by-month summary of the filed GSTR-3B returns, usually prepared by the borrower's CA: outward supplies from Table 3.1, output tax, net ITC from Table 4(C), tax paid in cash from Table 6.1 and the filing date.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Add a Customers sheet with customer-wise taxable value from GSTR-1 to see concentration.
              </p>
              <Button variant="outline" size="sm" className="mt-5" onClick={downloadTemplate} disabled={templating}>
                {templating ? <PiSpinnerLight className="h-4 w-4 animate-spin" /> : <PiDownloadSimpleLight className="h-4 w-4" />}
                Download the template
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">Column names don't have to match exactly; the common variants are recognised.</p>
            </aside>
          </section>
        ) : (
          <>
            {/* Figures */}
            <section className="panel">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 text-sm">
                {result.taxpayer.gstin ? (
                  <>
                    <span className="font-mono">{result.taxpayer.gstin.gstin}</span>
                    {result.taxpayer.gstin.format_ok
                      ? <span className="text-muted-foreground">{result.taxpayer.gstin.state} · PAN {result.taxpayer.gstin.pan}</span>
                      : <span className="chip bg-warn-bg text-warn">Format not valid</span>}
                  </>
                ) : <span className="text-muted-foreground">No GSTIN entered</span>}
                <span className="ml-auto text-xs text-muted-foreground">{result.taxpayer.filename}</span>
              </div>
              <div className="grid grid-cols-2 divide-border md:grid-cols-3 xl:grid-cols-6 [&>*]:border-b [&>*]:border-border/70 xl:[&>*]:border-b-0">
                <Figure label="Total outward supplies" value={amt(result.totals.turnover)} note={`Avg ${amt(result.totals.average_monthly_turnover)} a month`} />
                <Figure
                  label="Growth"
                  value={result.trend.growth?.pct != null ? `${result.trend.growth.pct > 0 ? "+" : ""}${result.trend.growth.pct.toFixed(1)}%` : "—"}
                  note={result.trend.growth?.basis ?? "Needs at least 6 months"}
                  tone={result.trend.growth?.pct != null ? (result.trend.growth.pct < -15 ? "risk" : result.trend.growth.pct < 0 ? "warn" : undefined) : undefined}
                />
                <Figure label="Output tax" value={amt(result.totals.output_tax)} note={result.ratios.effective_tax_rate_pct != null ? `${pct(result.ratios.effective_tax_rate_pct)} of taxable supplies` : undefined} />
                <Figure label="ITC to output tax" value={pct(result.ratios.itc_to_output_pct, 0)} note={result.ratios.cash_share_of_tax_pct != null ? `${pct(result.ratios.cash_share_of_tax_pct, 0)} paid in cash` : undefined} />
                <Figure label="Exports" value={pct(result.ratios.export_share_pct)} note="Zero-rated share of turnover" />
                <Figure
                  label="Late filings"
                  value={result.filing.months_with_dates ? `${result.filing.late_count} of ${result.filing.months_with_dates}` : "—"}
                  note={result.filing.months_with_dates ? (result.filing.late_count ? `Longest ${result.filing.max_delay_days} days late` : "All on time") : "No filing dates given"}
                  tone={result.filing.months_with_dates ? (result.filing.late_count ? "warn" : "ok") : undefined}
                />
              </div>
            </section>

            <div className="flex flex-wrap items-start gap-6">
              <div className="flex min-w-0 flex-[999_1_620px] flex-col gap-6">
                {/* Chart */}
                <section className="panel px-5 pb-5 pt-4">
                  <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-sans text-[15px] font-semibold tracking-normal">{withBank ? "Declared sales against bank credits" : "Monthly turnover"}</h2>
                    <span className="text-xs text-muted-foreground">Peak {result.trend.peak.month} · Lowest {result.trend.trough.month}</span>
                  </div>
                  <MonthlyChart rows={result.monthly} withBank={withBank} />
                </section>

                {/* Filing record */}
                <section className="panel px-5 pb-5 pt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-sans text-[15px] font-semibold tracking-normal">Filing record</h2>
                    <span className="text-xs text-muted-foreground">Due the 20th of the following month</span>
                  </div>
                  <ol className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
                    {result.filing.items.map((f) => {
                      const st = f.delay_days === null ? "unknown" : f.delay_days > 0 ? "late" : "ontime";
                      const cls = st === "late" ? (f.delay_days! > 15 ? "bg-risk-bg text-risk" : "bg-warn-bg text-warn") : st === "ontime" ? "bg-ok-bg text-ok" : "bg-muted text-muted-foreground";
                      return (
                        <li key={f.month} className={`rounded-md px-2 py-2 text-center ${cls}`} title={f.filed_on ? `${f.month}: filed ${f.filed_on}, due ${f.due}` : `${f.month}: no filing date`}>
                          <div className="text-[11px] font-medium text-foreground">{shortMonth(f.month)}</div>
                          <div className="mt-0.5 text-[11px] tabular-nums">{st === "unknown" ? "—" : st === "late" ? `+${f.delay_days}d` : "On time"}</div>
                        </li>
                      );
                    })}
                  </ol>
                  {result.period.missing_months.length > 0 && (
                    <p className="mt-3 text-xs text-warn">Not in the summary: {result.period.missing_months.join(", ")}.</p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">{result.filing.basis}</p>
                </section>

                {/* Monthly table */}
                <section className="panel">
                  <div className="flex items-baseline justify-between px-5 pb-3 pt-4">
                    <h2 className="font-sans text-[15px] font-semibold tracking-normal">Month by month</h2>
                    <span className="text-xs text-muted-foreground">Figures in {tableUnit.label}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="ledger w-full text-sm">
                      <thead>
                        <tr>
                          <th className="px-5 py-2 text-left">Month</th>
                          <th className="px-3 py-2 text-right">Taxable</th>
                          <th className="hidden px-3 py-2 text-right md:table-cell">Zero-rated</th>
                          <th className="hidden px-3 py-2 text-right md:table-cell">Exempt</th>
                          <th className="px-3 py-2 text-right">Output tax</th>
                          <th className="hidden px-3 py-2 text-right sm:table-cell">ITC</th>
                          <th className="hidden px-3 py-2 text-right sm:table-cell">Cash paid</th>
                          {withBank && <th className="px-5 py-2 text-right">Bank credits</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {result.monthly.map((m) => (
                          <tr key={m.month} className="border-t border-border/60">
                            <td className="whitespace-nowrap px-5 py-2.5">{m.label}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(m.taxable, tableUnit.div)}</td>
                            <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell">{num(m.zero_rated, tableUnit.div, true)}</td>
                            <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground md:table-cell">{num(m.exempt + m.non_gst, tableUnit.div, true)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(m.output_tax, tableUnit.div)}</td>
                            <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{num(m.itc, tableUnit.div)}</td>
                            <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{num(m.cash_paid, tableUnit.div)}</td>
                            {withBank && <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{num(m.bank_credits, tableUnit.div)}</td>}
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border font-semibold">
                          <td className="px-5 py-2.5">Total</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(result.totals.taxable, tableUnit.div)}</td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">{num(result.totals.zero_rated, tableUnit.div, true)}</td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">{num(result.totals.exempt + result.totals.non_gst, tableUnit.div, true)}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(result.totals.output_tax, tableUnit.div)}</td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums sm:table-cell">{num(result.totals.itc, tableUnit.div)}</td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums sm:table-cell">{num(result.totals.cash_paid, tableUnit.div)}</td>
                          {withBank && <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums">{num(result.reconciliation.bank?.bank_credits, tableUnit.div)}</td>}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="order-first flex min-w-0 flex-[1_1_340px] flex-col gap-6 min-[1100px]:order-none lg:max-w-[420px]">
                {/* Flags */}
                <section className="panel">
                  <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
                    <h2 className="font-sans text-[15px] font-semibold tracking-normal">Flags</h2>
                    <span className="text-xs text-muted-foreground">
                      {result.flags.length ? `${sevCounts.high} high · ${sevCounts.medium} medium · ${sevCounts.low} low` : "None raised"}
                    </span>
                  </div>
                  {result.flags.length ? (
                    <ul>
                      {result.flags.map((f, i) => (
                        <li key={i} className="border-t border-border/70 px-5 py-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm font-medium leading-snug">{f.title}</span>
                            <span className={`chip shrink-0 ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
                          </div>
                          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.detail}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-5 pb-5 text-sm text-muted-foreground">None of the checks crossed a threshold. This covers the figures in the summary only, not their accuracy.</p>
                  )}
                </section>

                {/* Reconciliation */}
                <section className="panel">
                  <div className="px-5 pb-2 pt-4"><h2 className="font-sans text-[15px] font-semibold tracking-normal">Reconciliation</h2></div>
                  {result.reconciliation.financials ? (() => {
                    const r = result.reconciliation.financials!;
                    const v = Math.abs(r.variance_pct);
                    return (
                      <ReconRow
                        title="GST turnover against the financials"
                        left={["GST returns", amt(r.gst_turnover)]}
                        right={["Financials", amt(r.financials_turnover)]}
                        verdict={`${r.variance_pct > 0 ? "+" : ""}${r.variance_pct.toFixed(1)}%`}
                        tone={v <= 10 ? "ok" : v <= 25 ? "warn" : "risk"}
                        note="Within 10% is usual; larger gaps need an explanation."
                      />
                    );
                  })() : (
                    <p className="border-t border-border/70 px-5 py-4 text-sm text-muted-foreground">Add turnover per financials to compare it with the returns.</p>
                  )}
                  {result.reconciliation.bank ? (
                    result.reconciliation.bank.months_compared && result.reconciliation.bank.ratio != null ? (() => {
                      const b = result.reconciliation.bank!;
                      const ratio = b.ratio!;
                      return (
                        <ReconRow
                          title={`Bank credits against GST gross sales · ${b.months_compared} months`}
                          left={["GST gross sales", amt(b.gst_gross_sales)]}
                          right={["Bank credits", amt(b.bank_credits)]}
                          verdict={`${Math.round(ratio * 100)}% covered`}
                          tone={ratio >= 0.7 && ratio <= 1.5 ? "ok" : ratio < 0.5 || ratio > 2 ? "risk" : "warn"}
                          note={b.basis}
                        />
                      );
                    })() : <p className="border-t border-border/70 px-5 py-4 text-sm text-warn">{result.reconciliation.bank.note}</p>
                  ) : (
                    <p className="border-t border-border/70 px-5 py-4 text-sm text-muted-foreground">Add the bank statement for the same months to check how much of the declared sales reached the account.</p>
                  )}
                </section>

                {/* Customers */}
                {result.concentration && (
                  <section className="panel px-5 pb-5 pt-4">
                    <div className="flex items-baseline justify-between">
                      <h2 className="font-sans text-[15px] font-semibold tracking-normal">Customers</h2>
                      <span className="text-xs text-muted-foreground">{custUnit.label} · top 5 hold {pct(result.concentration.top5_share_pct, 0)}</span>
                    </div>
                    <ul className="mt-4 space-y-3">
                      {result.concentration.top.slice(0, 6).map((c) => (
                        <li key={c.name + (c.gstin ?? "")}>
                          <div className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="truncate">{c.name}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{num(c.taxable_value, custUnit.div)}</span> · {pct(c.share_pct, 0)}</span>
                          </div>
                          <div className="bar-track mt-1.5 h-1.5"><div className="bar-fill" style={{ width: `${Math.max(1.5, c.share_pct)}%` }} /></div>
                        </li>
                      ))}
                    </ul>
                    {(result.concentration.customers > 6 || result.concentration.others_value) && (
                      <p className="mt-3 flex justify-between gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                        <span>{result.concentration.customers > 6 ? `${result.concentration.customers - 6} more named` : ""}{result.concentration.customers > 6 && result.concentration.others_value ? " · " : ""}{result.concentration.others_value ? "Other customers, not itemised" : ""}</span>
                        {result.concentration.others_value ? <span className="tabular-nums">{num(result.concentration.others_value, custUnit.div)} · {pct(result.concentration.others_share_pct, 0)}</span> : null}
                      </p>
                    )}
                  </section>
                )}

                {/* Observations */}
                <section className="panel px-5 pb-5 pt-4">
                  <h2 className="font-sans text-[15px] font-semibold tracking-normal">For the memorandum</h2>
                  <ul className="mt-3 space-y-2 text-[13px] leading-relaxed">
                    {result.observations.map((o, i) => (
                      <li key={i} className="flex gap-2.5"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />{o}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
