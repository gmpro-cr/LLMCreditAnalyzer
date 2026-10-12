import { useState } from "react";
import { useLocation } from "wouter";
import { signInDemo } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { CreditGuardMark } from "@/components/layout/Sidebar";

// Public page. Every statement here is something the product actually does;
// figures in the example are Bharat Forge Ltd's published FY26 consolidated
// numbers, labelled as such. No invented customers, savings or speed claims.

const STEPS = [
  {
    title: "Data room",
    body: "Enter the borrower's NSE/BSE symbol. Five years of consolidated statements, quarterly results, shareholding and listed peers are fetched, and the latest annual report is read for ratings, borrowings, contingent liabilities, related-party transactions, auditor remarks and the group structure.",
  },
  {
    title: "Draft",
    body: "A 21-section memorandum is drafted: CMA spread with conservative projections, DSCR on a stated basis, repayment schedule, sensitivity tests, covenant testing and a group organogram. Figures come from the data; the language model writes the commentary around them.",
  },
  {
    title: "Review",
    body: "Anything not in public filings — purpose, security, lenders, CIBIL, account conduct — is marked “RM to provide” and listed before sanction. The RM reviews and edits each section, records mitigations against risk flags, then submits for credit review.",
  },
  {
    title: "Export",
    body: "The approved memorandum exports as a PDF with sources and an audit trail of who generated, edited and reviewed it.",
  },
];

const LIMITS = [
  "It does not make credit decisions. The recommendation is a draft for the RM and credit officer to author.",
  "Public data is not audited data. Each figure carries its source; verify against audited statements before sanction.",
  "Borrowers without listed filings need their statements uploaded; the public-data steps do not apply to them.",
];

function ExampleSheet() {
  const rows: [string, string, string][] = [
    ["Revenue", "₹15,123 Cr", "₹16,812 Cr"],
    ["EBITDA margin", "17.8%", "17.4%"],
    ["PAT", "₹913 Cr", "₹1,089 Cr"],
    ["Total debt / EBITDA", "2.49x", "2.51x"],
    ["DSCR (pro forma)", "2.71x", "2.90x"],
  ];
  return (
    <figure className="rounded border border-border bg-card shadow-[0_1px_2px_hsl(212_43%_13%/0.06)]" aria-label="Example memorandum page">
      <div className="border-b border-border px-6 py-4">
        <div className="text-xs text-muted-foreground">Example · Section 7 of 21</div>
        <div className="mt-1 font-serif text-xl font-semibold">Bharat Forge Ltd — financial summary</div>
      </div>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="bg-muted text-xs text-muted-foreground">
            <th className="px-6 py-2 text-left font-medium">Consolidated</th>
            <th className="px-4 py-2 text-right font-medium">FY25</th>
            <th className="px-6 py-2 text-right font-medium">FY26</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k} className="border-t border-border/70">
              <td className="px-6 py-2">{k}</td>
              <td className="px-4 py-2 text-right text-muted-foreground">{a}</td>
              <td className="px-6 py-2 text-right font-medium">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
        Source: Screener.in consolidated statements; annual report FY2026 (BSE filing). DSCR includes a proposed ₹250 Cr term loan.
      </figcaption>
    </figure>
  );
}

export default function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const enterDemo = () => {
    if (loading) return;
    setLoading(true);
    signInDemo("demo@creditguard.ai");
    toast({ title: "You're in the demo workspace", description: "Cases here use public company data only." });
    setLocation("/");
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-8">
          <span className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
            <CreditGuardMark className="h-5 w-5 text-primary" /> CreditGuard
          </span>
          <nav className="ml-auto flex items-center gap-6 text-[13px]">
            <a href="#how-it-works" className="hidden text-muted-foreground hover:text-foreground sm:inline">How it works</a>
            <a href="#limits" className="hidden text-muted-foreground hover:text-foreground sm:inline">What it doesn't do</a>
            <Button size="sm" onClick={enterDemo} disabled={loading}>Enter demo workspace</Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-border bg-card">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:py-24">
            <div>
              <p className="text-[13px] font-medium text-primary">Credit appraisal for Indian banks</p>
              <h1 className="mt-3 text-[40px] leading-[1.1] sm:text-[52px]">
                Credit appraisal memorandums, drafted from filings and checked by your team.
              </h1>
              <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-muted-foreground">
                CreditGuard reads a listed borrower's statements and annual report, drafts a full CAM with every
                figure traced to its source, and lists what the relationship manager still has to provide before sanction.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button size="lg" onClick={enterDemo} disabled={loading}>Enter demo workspace</Button>
                <a href="#how-it-works" className="text-sm">See how a case moves</a>
              </div>
              <p className="mt-6 text-xs text-muted-foreground">Demo workspace · public company data only · no customer data is processed.</p>
            </div>
            <ExampleSheet />
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-8 lg:py-24">
          <h2 className="text-[32px] leading-tight">How a case moves</h2>
          <ol className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t-[3px] border-primary/80 pt-4">
                <div className="text-xs font-semibold text-primary">{i + 1}</div>
                <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="limits" className="border-t border-border bg-card">
          <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-16 sm:px-8 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="text-[32px] leading-tight">What it doesn't do</h2>
              <p className="mt-3 max-w-[40ch] text-[15px] text-muted-foreground">A memorandum is only as trustworthy as its sources. These limits are shown inside every case too.</p>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {LIMITS.map((l) => <li key={l} className="py-4 text-[15px] leading-relaxed">{l}</li>)}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:px-8">
          <span className="flex items-center gap-2"><CreditGuardMark className="h-4 w-4 text-primary" /> CreditGuard</span>
          <span>© {new Date().getFullYear()} CreditGuard · Demo workspace · No customer data is processed.</span>
        </div>
      </footer>
    </div>
  );
}
