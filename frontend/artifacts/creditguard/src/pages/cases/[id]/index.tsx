import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetCase,
  useUpdateCase,
  useListSections,
  useUpdateSection,
  useListRiskFlags,
  useGenerateMemo,
  useGetDataRoom,
  useGetCaseWorkspace,
  getGetCaseQueryKey,
  getListSectionsQueryKey,
  getListRiskFlagsQueryKey,
  getDataRoomQueryKey,
  getCaseWorkspaceQueryKey,
  MemoSection,
  type CamSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import DataRoomTab, { hasFinancialData, type DataRoomPanel } from "./DataRoomTab";
import DrawingPowerCalculator from "./DrawingPowerCalculator";
import { PiLockSimpleLight, PiLockSimpleOpenLight, PiSpinnerLight, PiWarningLight } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OutageState } from "@/components/outage-state";
import { isDataUnavailable } from "@/lib/query-state";
import { formatCr, formatDateTime, caseRef, facilityLabel } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown-view";

// ── Memorandum outline ─────────────────────────────────────────────────────

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Proposal", keys: ["executive_summary", "proposed_structure"] },
  { title: "Borrower", keys: ["business_profile", "group_organogram", "promoter_background", "industry_analysis"] },
  { title: "Financials", keys: ["financial_analysis", "sales_profitability", "leverage_debt", "working_capital_analysis", "interim_performance"] },
  { title: "Facility", keys: ["facility_assessment", "banking_arrangement", "peer_comparison"] },
  { title: "Risk & compliance", keys: ["contingent_rpt", "due_diligence", "risk_summary"] },
  { title: "Conclusion", keys: ["recommendation", "ews_checklist", "reference_check", "information_required"] },
];

type Status = { label: string; tone: "ok" | "warn" | "muted" };

function sectionStatus(s: MemoSection, groupVerified: boolean): Status {
  if (s.isReviewed) return { label: "Reviewed", tone: "ok" };
  if (!s.content?.trim()) return { label: "Not drafted", tone: "muted" };
  if (s.sectionKey === "group_organogram" && !groupVerified) return { label: "Verify", tone: "warn" };
  if (s.sectionKey === "due_diligence") {
    const pending = (s.content.match(/Pending — RM/g) || []).length;
    if (pending) return { label: `${pending} pending`, tone: "warn" };
  }
  const open = (s.content.match(/\[RM to provide/g) || []).length;
  if (open) return { label: `${open} input${open === 1 ? "" : "s"}`, tone: "warn" };
  return { label: "Draft", tone: "muted" };
}

const TONE: Record<Status["tone"], string> = { ok: "text-ok", warn: "text-warn", muted: "text-muted-foreground" };

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  high: { label: "High confidence", cls: "border-ok/25 bg-ok-bg text-ok" },
  medium: { label: "Medium confidence", cls: "border-border bg-muted text-muted-foreground" },
  low: { label: "Low confidence — check carefully", cls: "border-warn/25 bg-warn-bg text-warn" },
};

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-[3px] border px-1.5 py-px text-xs ${className}`}>{children}</span>;
}

// ── One memo section, rendered as a document sheet ─────────────────────────

function SectionSheet({
  section, index, total, generatedAt, caseId, onSave, dpProps,
}: {
  section: MemoSection;
  index: number;
  total: number;
  generatedAt?: string;
  caseId: number;
  onSave: (id: number, key: string, data: Partial<Pick<MemoSection, "content" | "isReviewed" | "isLocked">>) => Promise<void>;
  dpProps?: React.ComponentProps<typeof DrawingPowerCalculator>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(section.content);
  const { toast } = useToast();

  useEffect(() => { if (!isEditing) setContent(section.content); }, [section.content, isEditing]);

  const save = async (data: Partial<Pick<MemoSection, "content" | "isReviewed" | "isLocked">>, ok?: string) => {
    try {
      await onSave(caseId, section.sectionKey, data);
      if (ok) toast({ title: ok });
      return true;
    } catch {
      toast({ title: "Could not save. Please try again.", variant: "destructive" });
      return false;
    }
  };

  const conf = CONFIDENCE[section.confidence];
  const drafted = !!section.content?.trim();

  return (
    <article
      id={`section-${section.sectionKey}`}
      className="scroll-mt-24 rounded border border-border bg-card px-6 pb-7 pt-6 shadow-[0_1px_2px_hsl(212_43%_13%/0.06)] sm:px-12 sm:pt-9"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Section {index} of {total}</span>
        {section.isReviewed
          ? <Chip className="border-ok/25 bg-ok-bg text-ok">Reviewed</Chip>
          : drafted ? <Chip className="border-border">AI draft · not reviewed</Chip> : null}
        {conf && drafted && <Chip className={conf.cls}>{conf.label}</Chip>}
        {section.isLocked && <Chip className="border-border"><PiLockSimpleLight className="mr-1 h-3 w-3" />Locked — kept on regeneration</Chip>}
        {generatedAt && drafted && <span className="ml-auto">Generated {formatDateTime(generatedAt)}</span>}
      </div>
      <h2 className="mt-3 text-2xl text-foreground">{section.sectionTitle}</h2>

      <div className="mt-5">
        {isEditing && !section.isLocked ? (
          <div className="rounded border border-input">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save({ content }, "Section saved").then((ok) => ok && setIsEditing(false)); }
                if (e.key === "Escape") { setContent(section.content); setIsEditing(false); }
              }}
              className="min-h-[320px] resize-y rounded-none border-0 p-4 font-mono text-[13px] leading-relaxed focus-visible:ring-0"
              aria-label={`Edit ${section.sectionTitle}`}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2 border-t bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">Markdown · ⌘S to save · Esc to cancel</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setContent(section.content); setIsEditing(false); }}>Cancel</Button>
                <Button size="sm" onClick={() => save({ content }, "Section saved").then((ok) => ok && setIsEditing(false))}>Save</Button>
              </div>
            </div>
          </div>
        ) : drafted ? (
          <MarkdownView content={section.content} variant="document" />
        ) : (
          <p className="text-sm text-muted-foreground">Not drafted yet. Generate the draft, or write this section yourself.</p>
        )}
        {dpProps && <div className="mt-6"><DrawingPowerCalculator {...dpProps} /></div>}
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button size="sm" variant={section.isReviewed ? "outline" : "default"} onClick={() => save({ isReviewed: !section.isReviewed })} disabled={!drafted}>
          {section.isReviewed ? "Mark as not reviewed" : "Mark reviewed"}
        </Button>
        {!section.isLocked && !isEditing && <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>Edit text</Button>}
        <Button size="sm" variant="ghost" className="text-muted-foreground"
          onClick={() => save({ isLocked: !section.isLocked }, section.isLocked ? "Section unlocked" : "Section locked")}>
          {section.isLocked ? <><PiLockSimpleOpenLight className="mr-1.5 h-4 w-4" />Unlock</> : <><PiLockSimpleLight className="mr-1.5 h-4 w-4" />Lock</>}
        </Button>
      </div>
    </article>
  );
}

// ── Header pieces ──────────────────────────────────────────────────────────

type Step = { title: string; detail: string; state: "done" | "current" | "todo" };

function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-5 grid grid-cols-2 border-t border-border text-xs sm:grid-cols-5">
      {steps.map((s, i) => (
        <li key={s.title} className={`-mt-px border-t-[3px] py-3 pr-3 ${s.state === "done" ? "border-ok" : s.state === "current" ? "border-primary" : "border-border"}`}>
          <div className={`font-semibold ${s.state === "current" ? "text-primary" : s.state === "todo" ? "text-muted-foreground" : "text-foreground"}`}>{i + 1} · {s.title}</div>
          <div className="text-muted-foreground">{s.detail}</div>
        </li>
      ))}
    </ol>
  );
}

const TONE_TEXT = { ok: "text-ok", warn: "text-warn", risk: "text-risk" } as const;

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: keyof typeof TONE_TEXT }) {
  return (
    <div className="border-b border-border px-4 py-3.5 xl:border-b-0 xl:border-r xl:last:border-r-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-[-0.01em] text-foreground">{value}</div>
      {note && <div className={`text-[11px] ${tone ? TONE_TEXT[tone] : "text-muted-foreground"}`}>{note}</div>}
    </div>
  );
}

const fx = (v?: number | null) => (v === null || v === undefined ? "—" : `${v.toFixed(2)}x`);
const fp = (v?: number | null) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);
const fcr = (v?: number | null) => (v === null || v === undefined ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);

function FiguresStrip({ s }: { s: CamSummary }) {
  const m = s.metrics || {};
  const growth = m.sales_growth;
  const agencies = s.rating ? s.rating.split(";").map((r) => r.split(":")[0].trim()).filter(Boolean) : [];
  const lt = s.rating ? (s.rating.split(";")[0].split(":")[1] || "").trim().split(" ")[0] : "";
  return (
    <div className="mb-4 grid grid-cols-2 rounded border border-border bg-card sm:grid-cols-3 xl:grid-cols-6">
      <Figure label={`Revenue ${s.year ?? ""}`} value={fcr(m.sales)} note={growth != null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% YoY` : undefined} tone={growth != null ? (growth >= 0 ? "ok" : "risk") : undefined} />
      <Figure label="EBITDA margin" value={fp(m.ebitda_margin)} note={s.ebitda_margin_avg3 != null ? `3-yr avg ${s.ebitda_margin_avg3.toFixed(1)}%` : undefined} />
      <Figure label="Total debt / EBITDA" value={fx(m.debt_ebitda)} note="Covenant ≤ 3.50x" tone={m.debt_ebitda != null && m.debt_ebitda > 3.5 ? "risk" : undefined} />
      <Figure label="DSCR (pro forma)" value={fx(m.dscr)} note="Benchmark ≥ 1.25x" tone={m.dscr != null && m.dscr < 1.25 ? "risk" : undefined} />
      <Figure label="External rating" value={lt || "—"} note={agencies.length ? agencies.join(", ") : "Not available"} />
      <Figure label="Internal grade" value={s.grade ?? "—"} note={s.grade_score != null ? `Model ${s.grade_score} / 100` : undefined} />
    </div>
  );
}

function RailBox({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ── Generation progress ────────────────────────────────────────────────────

const GENERATION_STAGES = [
  { at: 0, label: "Validating financial data" },
  { at: 2, label: "Computing ratios and risk flags" },
  { at: 5, label: "Drafting the memorandum sections" },
  { at: 20, label: "Formatting tables and sources" },
];

function GenerationProgress({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stage = [...GENERATION_STAGES].reverse().find((s) => elapsed >= s.at) ?? GENERATION_STAGES[0];
  return (
    <div className="mb-4 rounded border border-primary/25 bg-card p-5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{elapsed > 45 ? "Still drafting" : stage.label}…</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {elapsed > 45 ? "Taking longer than usual — the AI engine may have been asleep, or a backup model is drafting. Up to 3 minutes." : "A full draft usually takes 20–40 seconds."}
          </p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
      </div>
      <div className="mt-4 h-0.5 w-full overflow-hidden bg-primary/10"><div className="h-full w-1/3 animate-indeterminate bg-primary/70" /></div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CaseDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: caseData, isLoading: caseLoading, isError: caseError, refetch: refetchCase, isFetching: caseFetching } =
    useGetCase(id, { query: { enabled: !!id, queryKey: getGetCaseQueryKey(id) } });
  const { data: sections, isLoading: sectionsLoading } =
    useListSections(id, { query: { enabled: !!id, queryKey: getListSectionsQueryKey(id) } });
  const { data: riskFlags } = useListRiskFlags(id, { query: { enabled: !!id, queryKey: getListRiskFlagsQueryKey(id) } });
  const { data: dataRoom } = useGetDataRoom(id);
  const { data: workspace } = useGetCaseWorkspace(id);

  const updateSection = useUpdateSection();
  const updateCase = useUpdateCase();
  const generateMemo = useGenerateMemo();
  const [generating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [tab, setTab] = useState<"memo" | "dataroom">("memo");
  const [roomPanel, setRoomPanel] = useState<DataRoomPanel>("financials");

  // Wake the free-tier AI engine as soon as a case opens (cold start ~50s).
  useEffect(() => { fetch(`${import.meta.env.VITE_API_URL || ""}/api/python-wake`).catch(() => {}); }, []);

  const summary = workspace?.summary ?? null;
  const hasContent = !!sections?.some((s) => s.content?.trim());
  const missingFinancials = dataRoom !== undefined && !hasFinancialData(dataRoom);
  const symbol = (dataRoom?.extractedData?.financials as { company_info?: { symbol?: string } } | undefined)?.company_info?.symbol || "";

  const openRoom = (panel: DataRoomPanel) => { setRoomPanel(panel); setTab("dataroom"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const handleGenerate = async () => {
    if (missingFinancials) { openRoom("financials"); return; }
    setTab("memo");
    setStartedAt(Date.now());
    setGenerating(true);
    try {
      const result = await generateMemo.mutateAsync({ id }) as unknown as { failedSections?: string[] };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListSectionsQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getCaseWorkspaceQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getListRiskFlagsQueryKey(id) }),
      ]);
      const failed = result?.failedSections ?? [];
      if (failed.length) {
        toast({
          title: `Draft ready — ${failed.length} section${failed.length === 1 ? "" : "s"} not drafted`,
          description: `The AI service was busy for: ${failed.map((k) => k.replace(/_/g, " ")).join(", ")}. They keep their previous text; regenerate in a minute.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Draft ready", description: "All sections drafted. Review each one before submitting." });
      }
    } catch (e) {
      const data = e && typeof e === "object" && "data" in e ? (e as { data?: { error?: string; code?: string } }).data : undefined;
      if (data?.code === "no_financial_data") {
        await queryClient.invalidateQueries({ queryKey: getDataRoomQueryKey(id) });
        openRoom("financials");
      }
      toast({ title: "Generation failed", description: data?.error || (e instanceof Error ? e.message : "Could not reach the AI service. Try again."), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateSection = useCallback(async (caseId: number, sectionKey: string, data: Partial<Pick<MemoSection, "content" | "isReviewed" | "isLocked">>) => {
    await updateSection.mutateAsync({ id: caseId, sectionKey, data });
    queryClient.setQueryData(getListSectionsQueryKey(caseId), (old: MemoSection[] | undefined) =>
      old?.map((s) => (s.sectionKey === sectionKey ? { ...s, ...data } : s)));
    queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
  }, [updateSection, queryClient]);

  const setStatus = async (status: "draft" | "in_review" | "approved" | "rejected", msg: string) => {
    try {
      await updateCase.mutateAsync({ id, data: { status } });
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getCaseWorkspaceQueryKey(id) });
      toast({ title: msg });
    } catch {
      toast({ title: "Could not update the case status.", variant: "destructive" });
    }
  };

  const ordered = useMemo(() => {
    const byKey = new Map((sections ?? []).map((s) => [s.sectionKey, s]));
    const known = GROUPS.flatMap((g) => g.keys).filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
    const rest = (sections ?? []).filter((s) => !GROUPS.some((g) => g.keys.includes(s.sectionKey)));
    return [...known, ...rest];
  }, [sections]);
  const reviewed = ordered.filter((s) => s.isReviewed).length;
  const openItems = (summary?.info_requests ?? []).filter((r) => r.priority === "Before sanction");

  if (isDataUnavailable(caseError, caseLoading, caseData)) {
    return (
      <div className="mx-auto max-w-[1440px] p-8">
        <OutageState title="Can't load this case" description="The case is safe — the service is unreachable right now. This usually clears in a few minutes." onRetry={() => refetchCase()} isRetrying={caseFetching} />
      </div>
    );
  }
  if (caseLoading || !caseData) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-6 p-8">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-6 lg:grid-cols-[236px_1fr_320px]"><Skeleton className="h-96" /><Skeleton className="h-[600px]" /><Skeleton className="h-96" /></div>
      </div>
    );
  }

  const status = caseData.status;
  const steps: Step[] = [
    { title: "Data room", detail: missingFinancials ? "Financials needed" : "Financials and filings", state: missingFinancials ? "current" : "done" },
    { title: "AI draft", detail: summary?.generated_at ? `Generated ${formatDateTime(summary.generated_at)}` : hasContent ? "Drafted" : "Not generated", state: hasContent ? "done" : missingFinancials ? "todo" : "current" },
    { title: "RM review", detail: `${reviewed} of ${ordered.length} sections reviewed`, state: status !== "draft" ? "done" : hasContent ? "current" : "todo" },
    { title: "Credit officer", detail: status === "in_review" ? "In review" : status === "approved" ? "Approved" : status === "rejected" ? "Returned to RM" : "Not started", state: status === "approved" ? "done" : status === "in_review" || status === "rejected" ? "current" : "todo" },
    { title: "Sanction", detail: status === "approved" ? "Ready for sanction" : "—", state: status === "approved" ? "current" : "todo" },
  ];

  return (
    <div>
      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-8">
          <div className="text-xs text-muted-foreground">
            <Link href="/cases" className="text-muted-foreground hover:text-foreground">Cases</Link>
            <span className="mx-1.5">/</span>
            <span className="font-mono">{caseRef(caseData.id, caseData.createdAt)}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="min-w-0 flex-[1_1_520px]">
              <h1 className="text-[32px] leading-tight text-foreground">{caseData.borrowerName}</h1>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                {symbol && <span>NSE: {symbol}</span>}
                <span>{caseData.sector}</span>
                <span>Proposed: <strong className="font-semibold text-foreground">{facilityLabel(caseData.facilityType)} {formatCr(caseData.facilityAmount)}</strong></span>
                <span>RM: {caseData.rmName}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
                {generating ? <><PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" />Drafting…</> : missingFinancials ? "Add financials first" : hasContent ? "Regenerate draft" : "Generate draft"}
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`${import.meta.env.VITE_API_URL || ""}/api/cases/${id}/export-pdf`} download={`CAM_${caseData.borrowerName}.pdf`}>Export PDF</a>
              </Button>
              {status === "draft" && (
                <Button size="sm" onClick={() => setStatus("in_review", "Submitted for credit review")} disabled={!hasContent}
                  title={openItems.length ? `${openItems.length} pre-sanction items are still open` : undefined}>
                  Submit for credit review
                </Button>
              )}
              {status === "in_review" && (
                <>
                  <Button size="sm" variant="outline" className="border-risk/30 text-risk hover:bg-risk-bg" onClick={() => setStatus("rejected", "Returned to the RM")}>Return to RM</Button>
                  <Button size="sm" onClick={() => setStatus("approved", "Memorandum approved")}>Approve memorandum</Button>
                </>
              )}
              {status === "rejected" && <Button size="sm" variant="outline" onClick={() => setStatus("draft", "Moved back to draft")}>Reopen as draft</Button>}
            </div>
          </div>
          <Stepper steps={steps} />
          <div className="flex gap-6 text-[13px]" role="tablist">
            {([["memo", "Memorandum"], ["dataroom", "Data room"]] as const).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => { if (k === "dataroom") setRoomPanel("financials"); setTab(k); }}
                className={`-mb-px border-b-2 py-2.5 transition-colors ${tab === k ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === "dataroom" ? (
        <div className="mx-auto max-w-[1440px]">
          <DataRoomTab caseId={id} companyName={caseData.borrowerName} facilityType={caseData.facilityType} initialPanel={roomPanel} />
        </div>
      ) : (
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-start gap-6 px-4 pb-16 pt-6 sm:px-8">
          <aside className="hidden text-[13px] lg:sticky lg:top-20 lg:block lg:w-[236px] lg:flex-none" aria-label="Memorandum outline">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Memorandum</div>
            {sectionsLoading ? <Skeleton className="mt-3 h-80" /> : GROUPS.map((g) => {
              const items = g.keys.map((k) => ordered.find((s) => s.sectionKey === k)).filter(Boolean) as MemoSection[];
              if (!items.length) return null;
              return (
                <div key={g.title}>
                  <div className="mb-1 mt-3 text-xs text-muted-foreground">{g.title}</div>
                  {items.map((s) => {
                    const st = sectionStatus(s, !!summary?.group_verified);
                    return (
                      <a key={s.sectionKey} href={`#section-${s.sectionKey}`}
                        className="flex items-start justify-between gap-3 rounded-sm px-2 py-1 leading-snug text-foreground hover:bg-card hover:no-underline">
                        <span>{s.sectionTitle}</span>
                        <span className={`shrink-0 pt-px text-xs ${TONE[st.tone]}`}>{st.label}</span>
                      </a>
                    );
                  })}
                </div>
              );
            })}
          </aside>

          <div className="min-w-0 flex-[999_1_560px]">
            {summary && <FiguresStrip s={summary} />}
            {missingFinancials && !hasContent && (
              <div className="mb-4 flex flex-wrap items-start gap-4 rounded border border-warn/25 bg-warn-bg p-5">
                <PiWarningLight className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Add financials before generating the draft</p>
                  <p className="mt-1 text-sm text-muted-foreground">Fetch them for a listed company, or upload annual reports or CMA data in the Data room.</p>
                </div>
                <Button size="sm" onClick={() => openRoom("financials")}>Open Data room</Button>
              </div>
            )}
            {generating && <GenerationProgress startedAt={startedAt} />}
            {sectionsLoading ? (
              <div className="space-y-4"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
            ) : hasContent ? (
              <div className={`space-y-4 transition-opacity ${generating ? "pointer-events-none opacity-50" : ""}`}>
                {ordered.map((s, i) => (
                  <SectionSheet
                    key={s.id}
                    section={s}
                    index={i + 1}
                    total={ordered.length}
                    generatedAt={summary?.generated_at}
                    caseId={id}
                    onSave={handleUpdateSection}
                    dpProps={(caseData.facilityType === "working_capital" || caseData.facilityType === "overdraft") && s.sectionKey === "facility_assessment"
                      ? { proposedLimit: Math.round((caseData.facilityAmount ?? 0) / 1e7) } : undefined}
                  />
                ))}
              </div>
            ) : !generating && (
              <div className="rounded border border-border bg-card px-8 py-16 text-center">
                <h2 className="text-2xl">No draft yet</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  The draft is built from the Data room: financials, the latest annual report, peers and research. Every figure in it is traced to its source.
                </p>
                <Button className="mt-6" onClick={handleGenerate}>{missingFinancials ? "Add financials first" : "Generate draft"}</Button>
              </div>
            )}
          </div>

          <aside className="flex w-full flex-col gap-4 lg:sticky lg:top-20 lg:w-[320px] lg:flex-none">
            <RailBox title="Before sanction" aside={summary ? <span className={`text-xs font-medium ${openItems.length ? "text-warn" : "text-ok"}`}>{openItems.length ? `${openItems.length} open` : "None open"}</span> : undefined}>
              {summary ? (
                <>
                  <ul className="px-4 py-2 text-[13px]">
                    {openItems.slice(0, 5).map((r) => <li key={r.item} className="border-b border-border/70 py-1.5 last:border-0">{r.item}</li>)}
                    {!openItems.length && <li className="py-1.5 text-muted-foreground">All pre-sanction information is in.</li>}
                  </ul>
                  <div className="px-4 pb-3"><button onClick={() => openRoom("rm")} className="text-[13px] font-medium text-primary hover:underline">Open RM inputs</button></div>
                </>
              ) : <p className="px-4 py-3 text-[13px] text-muted-foreground">Listed here after the first draft.</p>}
            </RailBox>

            <RailBox title="Risk flags" aside={<Link href={`/cases/${id}/risks`} className="text-xs">Review</Link>}>
              {(riskFlags ?? []).length ? (riskFlags ?? []).slice(0, 4).map((r) => (
                <div key={r.id} className="border-b border-border/70 px-4 py-2.5 text-[13px] last:border-0">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{r.riskType}</span>
                    <Chip className={r.severity === "high" ? "border-risk/25 bg-risk-bg text-risk" : r.severity === "medium" ? "border-warn/25 bg-warn-bg text-warn" : "border-border text-muted-foreground"}>
                      {r.severity === "high" ? "High" : r.severity === "medium" ? "Medium" : "Low"}
                    </Chip>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</div>
                </div>
              )) : <p className="px-4 py-3 text-[13px] text-muted-foreground">{hasContent ? "No ratio-based risk flags." : "Computed with the draft."}</p>}
            </RailBox>

            {summary?.sources?.length ? (
              <RailBox title="Sources">
                <ol className="list-decimal py-2.5 pl-8 pr-4 text-xs text-muted-foreground">
                  {summary.sources.map((s) => (
                    <li key={s.label} className="py-0.5">{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}</li>
                  ))}
                </ol>
              </RailBox>
            ) : null}

            <RailBox title="Audit trail">
              <ul className="px-4 py-2.5 text-xs text-muted-foreground">
                {(workspace?.activity ?? []).slice(0, 6).map((a, i) => (
                  <li key={i} className="flex gap-3 py-1">
                    <span className="shrink-0 tabular-nums">{formatDateTime(a.timestamp)}</span>
                    <span className="text-foreground/80">{a.action}{a.actor && a.actor !== "CreditGuard AI" ? ` · ${a.actor}` : ""}</span>
                  </li>
                ))}
                {!workspace?.activity?.length && <li className="py-1">No activity yet.</li>}
              </ul>
            </RailBox>
          </aside>
        </div>
      )}
    </div>
  );
}
