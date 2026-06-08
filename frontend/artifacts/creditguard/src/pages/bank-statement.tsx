import { useState } from "react";
import {
  PiUploadSimpleLight,
  PiFileLight,
  PiSpinnerLight,
  PiWarningLight,
  PiTrendUpLight,
  PiTrendDownLight,
  PiWalletLight,
  PiPulseLight,
  PiShieldWarningLight,
  PiShieldCheckLight,
  PiCheckCircleLight,
  PiCalendarBlankLight,
  PiFileArrowDownLight,
} from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

interface RecurringItem {
  counterparty: string;
  occurrences: number;
  median_amount: number;
  total_amount: number;
  first_seen: string;
  last_seen: string;
  sample_description: string;
}

interface MonthRow {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
  txn_count: number;
  closing_balance: number | null;
}

interface BounceItem {
  date: string;
  description: string;
  amount: number;
  type: "inward" | "outward";
}

interface AnalysisResult {
  account: { holder: string; filename: string; period: { from: string; to: string; months: number }; transactions: number };
  totals: {
    total_inflow: number; total_outflow: number; net_cash_flow: number;
    credit_count: number; debit_count: number;
    opening_balance: number | null; closing_balance: number | null;
  };
  balance_metrics: {
    average: number | null; minimum: number | null; maximum: number | null;
    amb: number | null; volatility_pct: number | null; negative_days: number;
  };
  monthly_trend: MonthRow[];
  salary_or_primary_income: RecurringItem[];
  recurring_credits: RecurringItem[];
  recurring_debits: RecurringItem[];
  emi_obligations: RecurringItem[];
  cash_activity: {
    cash_deposits: { count: number; total: number; max_single: number };
    cash_withdrawals: { count: number; total: number; max_single: number };
  };
  cheque_returns: { count: number; items: BounceItem[] };
  counterparty_concentration: {
    top_inflow_counterparties: { counterparty: string; amount: number; share_pct: number }[];
    top_outflow_counterparties: { counterparty: string; amount: number; share_pct: number }[];
  };
  risk_flags: { code: string; severity: "high" | "medium" | "low"; title: string; detail: string }[];
  score: { value: number; rating: string; scale: string };
  underwriter_observations: string[];
}

function inr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function severityClasses(s: "high" | "medium" | "low") {
  if (s === "high") return "border-red-200 bg-red-50/50 text-red-900";
  if (s === "medium") return "border-amber-200 bg-amber-50/50 text-amber-900";
  return "border-blue-200 bg-blue-50/50 text-blue-900";
}

function ratingClasses(rating: string) {
  if (rating === "Strong") return "text-emerald-600 bg-emerald-100 border-emerald-200";
  if (rating === "Acceptable") return "text-blue-600 bg-blue-100 border-blue-200";
  if (rating === "Borderline") return "text-amber-600 bg-amber-100 border-amber-200";
  return "text-red-600 bg-red-100 border-red-200";
}

export default function BankStatement() {
  const [file, setFile] = useState<File | null>(null);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [holder, setHolder] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const { toast } = useToast();

  const handleFile = (f: File) => {
    const ok = /\.(pdf|csv|xlsx|xls)$/i.test(f.name);
    if (!ok) {
      toast({ title: "Unsupported file", description: "Upload PDF, CSV, or Excel.", variant: "destructive" });
      return;
    }
    setFile(f);
  };

  const onAnalyze = async () => {
    if (!file) { toast({ title: "Upload a statement first", variant: "destructive" }); return; }
    setAnalyzing(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (periodFrom) fd.append("periodFrom", periodFrom);
      if (periodTo) fd.append("periodTo", periodTo);
      if (holder) fd.append("accountHolder", holder);

      const res = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/bank-statement/analyze`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Analysis failed");
      }
      setResult(data as AnalysisResult);
      toast({ title: "Analysis complete", description: `${data.account.transactions} transactions analyzed.` });
    } catch (e) {
      toast({ title: "Analysis failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => { setFile(null); setResult(null); setPeriodFrom(""); setPeriodTo(""); setHolder(""); };

  const onDownloadExcel = async () => {
    if (!file) {
      toast({ title: "Re-upload the statement to export", description: "The file is needed to regenerate the workbook.", variant: "destructive" });
      return;
    }
    setDownloading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (periodFrom) fd.append("periodFrom", periodFrom);
      if (periodTo) fd.append("periodTo", periodTo);
      if (holder) fd.append("accountHolder", holder);

      const res = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/bank-statement/excel`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const parsed = (() => { try { return JSON.parse(txt); } catch { return null; } })();
        throw new Error(parsed?.error || "Excel export failed");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || "BankStatementAnalysis.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Excel report downloaded", description: filename });
    } catch (e) {
      toast({ title: "Download failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl tracking-[-0.02em]">Bank statement analysis</h1>
          <p className="text-muted-foreground mt-1">
            Upload a bank statement and get a banker-grade analysis: cash flow, AMB, recurring income, EMI obligations, bounces, and a creditworthiness score.
          </p>
        </div>
        {result && (
          <div className="flex items-center gap-2">
            <Button onClick={onDownloadExcel} disabled={downloading}>
              {downloading ? (
                <><PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> Building workbook…</>
              ) : (
                <><PiFileArrowDownLight className="mr-2 h-4 w-4" /> Download Excel Report</>
              )}
            </Button>
            <Button variant="outline" onClick={reset}>Analyze another statement</Button>
          </div>
        )}
      </div>

      {!result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <PiUploadSimpleLight className="h-5 w-5 text-primary" /> Upload statement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <label
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 cursor-pointer transition-colors ${file ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <input type="file" className="hidden" accept=".pdf,.csv,.xlsx,.xls"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {file ? (
                <>
                  <PiFileLight className="h-8 w-8 text-primary mb-2" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB · click to change</span>
                </>
              ) : (
                <>
                  <PiUploadSimpleLight className="h-8 w-8 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">Drop your bank statement here</span>
                  <span className="text-xs text-muted-foreground mt-1">PDF, CSV, or Excel · text-based PDFs only · up to 25 MB</span>
                </>
              )}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="from"><PiCalendarBlankLight className="inline h-3.5 w-3.5 mr-1" /> Period from</Label>
                <Input id="from" type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to"><PiCalendarBlankLight className="inline h-3.5 w-3.5 mr-1" /> Period to</Label>
                <Input id="to" type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="holder">Account holder (optional)</Label>
                <Input id="holder" placeholder="e.g. Acme Industries Pvt Ltd" value={holder} onChange={e => setHolder(e.target.value)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              If you leave the period blank, the analysis will cover all transactions in the file.
              Indian conventions assumed: ₹ amounts, DD/MM/YYYY dates, debit/credit columns or signed amount.
            </p>

            <div className="flex justify-end">
              <Button onClick={onAnalyze} disabled={!file || analyzing} className="min-w-[180px]">
                {analyzing ? (
                  <><PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> Analyzing…</>
                ) : (
                  <><PiPulseLight className="mr-2 h-4 w-4" /> Run Analysis</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {result && <AnalysisReport data={result} />}
    </div>
  );
}

// ── Report ───────────────────────────────────────────────────────────────────

function AnalysisReport({ data }: { data: AnalysisResult }) {
  const { account, totals, balance_metrics, monthly_trend, salary_or_primary_income, recurring_credits, recurring_debits, emi_obligations, cash_activity, cheque_returns, counterparty_concentration, risk_flags, score, underwriter_observations } = data;

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Account</div>
              <div className="text-lg font-semibold">{account.holder}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{account.filename}</div>
              <div className="text-sm mt-2">
                Period: <span className="font-medium">{account.period.from}</span> → <span className="font-medium">{account.period.to}</span>
                <span className="ml-2 text-muted-foreground">({account.period.months} mo · {account.transactions} txns)</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Creditworthiness Score</div>
              <div className="flex items-baseline gap-2 justify-end">
                <span className="text-4xl font-bold">{score.value}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <Badge className={`mt-1 border ${ratingClasses(score.rating)}`}>{score.rating}</Badge>
              <div className="mt-2 w-48">
                <Progress value={score.value} className="h-2" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Underwriter observations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><PiCheckCircleLight className="h-4 w-4 text-primary" /> Underwriter Observations</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm leading-relaxed">
            {underwriter_observations.map((o, i) => (
              <li key={i} className="flex gap-2"><span className="text-primary mt-1">•</span><span>{o}</span></li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={<PiTrendUpLight className="h-4 w-4 text-emerald-500" />} label="Total Inflow" value={inr(totals.total_inflow)} sub={`${totals.credit_count} credits`} />
        <Kpi icon={<PiTrendDownLight className="h-4 w-4 text-red-500" />} label="Total Outflow" value={inr(totals.total_outflow)} sub={`${totals.debit_count} debits`} />
        <Kpi icon={<PiPulseLight className="h-4 w-4 text-blue-500" />} label="Net Cash Flow" value={inr(totals.net_cash_flow)} sub="credits − debits" />
        <Kpi icon={<PiWalletLight className="h-4 w-4 text-violet-500" />} label="Avg Monthly Balance" value={inr(balance_metrics.amb)} sub={`min ${inr(balance_metrics.minimum)}`} />
      </div>

      {/* Risk flags */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {risk_flags.length === 0
              ? <PiShieldCheckLight className="h-4 w-4 text-emerald-500" />
              : <PiShieldWarningLight className="h-4 w-4 text-amber-500" />}
            Risk Flags
            <Badge variant="secondary" className="ml-1">{risk_flags.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {risk_flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No red flags detected. Account behavior is consistent with healthy underwriting profile.</p>
          ) : (
            <div className="space-y-3">
              {risk_flags.map(f => (
                <div key={f.code} className={`p-3 rounded-md border ${severityClasses(f.severity)}`}>
                  <div className="flex items-start gap-2">
                    <PiWarningLight className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{f.title}</p>
                        <Badge variant="outline" className="text-[10px] uppercase">{f.severity}</Badge>
                      </div>
                      <p className="text-xs mt-1 opacity-90">{f.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly trend */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Monthly Cash Flow</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 px-3 font-medium text-right">Inflow</th>
                <th className="py-2 px-3 font-medium text-right">Outflow</th>
                <th className="py-2 px-3 font-medium text-right">Net</th>
                <th className="py-2 px-3 font-medium text-right">Txns</th>
                <th className="py-2 pl-3 font-medium text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {monthly_trend.map(m => (
                <tr key={m.month} className="border-b last:border-b-0">
                  <td className="py-2 pr-3 font-medium">{m.month}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-600">{inr(m.inflow)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-red-600">{inr(m.outflow)}</td>
                  <td className={`py-2 px-3 text-right font-mono tabular-nums ${m.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{inr(m.net)}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{m.txn_count}</td>
                  <td className="py-2 pl-3 text-right font-mono tabular-nums">{inr(m.closing_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Income & EMI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecurringList title="Primary / Recurring Income" subtitle="Salary or business inflow detected" items={salary_or_primary_income.length ? salary_or_primary_income : recurring_credits.slice(0, 5)} accent="emerald" />
        <RecurringList title="EMI / Loan Obligations" subtitle="Recurring loan or NBFC debits" items={emi_obligations} accent="amber" />
      </div>

      {/* Cash activity & bounces */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Cash Activity</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <CashStat label="Cash Deposits" count={cash_activity.cash_deposits.count} total={cash_activity.cash_deposits.total} max={cash_activity.cash_deposits.max_single} accent="emerald" />
              <CashStat label="Cash Withdrawals" count={cash_activity.cash_withdrawals.count} total={cash_activity.cash_withdrawals.total} max={cash_activity.cash_withdrawals.max_single} accent="red" />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Banks heavily discount cash income for assessable repayment capacity. High cash dependence is a credit-quality signal.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Cheque / ECS Returns
              <Badge variant={cheque_returns.count > 0 ? "destructive" : "secondary"}>{cheque_returns.count}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cheque_returns.count === 0 ? (
              <p className="text-sm text-muted-foreground">No bounce or return charges detected — clean record.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {cheque_returns.items.map((b, i) => (
                  <div key={i} className="flex items-center justify-between p-2 border rounded-md bg-red-50/30 text-xs">
                    <div>
                      <div className="font-medium">{b.date} · {b.type}</div>
                      <div className="text-muted-foreground line-clamp-1">{b.description}</div>
                    </div>
                    <div className="font-mono tabular-nums">{inr(b.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Balance metrics */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Balance Metrics</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <Metric label="Average Balance" value={inr(balance_metrics.average)} />
            <Metric label="AMB" value={inr(balance_metrics.amb)} />
            <Metric label="Minimum" value={inr(balance_metrics.minimum)} />
            <Metric label="Maximum" value={inr(balance_metrics.maximum)} />
            <Metric label="Volatility" value={balance_metrics.volatility_pct != null ? `${balance_metrics.volatility_pct.toFixed(1)}%` : "—"} />
          </div>
          {balance_metrics.negative_days > 0 && (
            <p className="text-xs text-red-600 mt-3">
              <PiWarningLight className="inline h-3.5 w-3.5 mr-1" />
              Account spent {balance_metrics.negative_days} day(s) in negative balance.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Counterparty concentration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ConcentrationList title="Top Inflow Counterparties" items={counterparty_concentration.top_inflow_counterparties} accent="emerald" />
        <ConcentrationList title="Top Outflow Counterparties" items={counterparty_concentration.top_outflow_counterparties} accent="red" />
      </div>

      {/* Recurring debits (other than EMI) */}
      {recurring_debits.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Other Recurring Debits</CardTitle></CardHeader>
          <CardContent>
            <RecurringTable items={recurring_debits} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-bold mt-2 font-mono tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-mono tabular-nums font-medium mt-0.5">{value}</div>
    </div>
  );
}

function CashStat({ label, count, total, max, accent }: { label: string; count: number; total: number; max: number; accent: "emerald" | "red" }) {
  const color = accent === "emerald" ? "text-emerald-600" : "text-red-600";
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 font-mono tabular-nums ${color}`}>{inr(total)}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{count} txns · max {inr(max)}</div>
    </div>
  );
}

function RecurringList({ title, subtitle, items, accent }: { title: string; subtitle: string; items: RecurringItem[]; accent: "emerald" | "amber" }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None detected.</p>
        ) : (
          <RecurringTable items={items} accent={accent} />
        )}
      </CardContent>
    </Card>
  );
}

function RecurringTable({ items, accent }: { items: RecurringItem[]; accent?: "emerald" | "amber" }) {
  const dot = accent === "emerald" ? "bg-emerald-500" : accent === "amber" ? "bg-amber-500" : "bg-muted-foreground";
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-medium">Counterparty</th>
          <th className="py-2 px-3 font-medium text-right">Median</th>
          <th className="py-2 px-3 font-medium text-right">Total</th>
          <th className="py-2 pl-3 font-medium text-right">Count</th>
        </tr>
      </thead>
      <tbody>
        {items.slice(0, 8).map((r, i) => (
          <tr key={i} className="border-b last:border-b-0">
            <td className="py-2 pr-3">
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
                <span className="font-medium truncate max-w-[260px]">{r.counterparty}</span>
              </div>
              <div className="text-xs text-muted-foreground line-clamp-1 ml-3.5">{r.sample_description}</div>
            </td>
            <td className="py-2 px-3 text-right font-mono tabular-nums">{inr(r.median_amount)}</td>
            <td className="py-2 px-3 text-right font-mono tabular-nums">{inr(r.total_amount)}</td>
            <td className="py-2 pl-3 text-right text-muted-foreground">{r.occurrences}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConcentrationList({ title, items, accent }: { title: string; items: { counterparty: string; amount: number; share_pct: number }[]; accent: "emerald" | "red" }) {
  const bar = accent === "emerald" ? "bg-emerald-500" : "bg-red-500";
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <div className="space-y-2.5">
            {items.map((c, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate max-w-[280px]">{c.counterparty}</span>
                  <span className="text-xs text-muted-foreground">{c.share_pct}%</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full ${bar}`} style={{ width: `${Math.min(100, c.share_pct)}%` }} />
                  </div>
                  <span className="text-xs font-mono tabular-nums w-24 text-right">{inr(c.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
