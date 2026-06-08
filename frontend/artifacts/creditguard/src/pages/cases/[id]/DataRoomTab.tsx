import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDataRoom,
  useGetPeers,
  useFetchAnnualReports,
  useRunResearch,
  usePiUploadSimpleLightDocument,
  useDeleteDocument,
  useUpdatePeers,
  useSaveOrganogramTree,
  searchCompanies,
  getDataRoomQueryKey,
  getPeersQueryKey,
  type DataRoomState,
  type Peer,
  type CaseDocument,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  PiPiFileTextLightLight, PiTrashLight, PiPiUploadSimpleLightSimpleLight, PiMagnifyingGlassLight, PiArrowClockwiseLight,
  PiSpinnerLight, PiBuildingsLight, PiPiNewspaperLightLight, PiPiFolderOpenLightLight, PiCheckCircleLight,
  PiWarningCircleLight, PiPlusLight, PiXLight,
} from "react-icons/pi";

// ── StatusBadge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "ok" | "missing" | "optional" }) {
  if (status === "ok") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">✓ Available</Badge>;
  if (status === "missing") return <Badge variant="outline" className="text-amber-600 border-amber-300">Missing</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Optional</Badge>;
}

// ── FilePiUploadSimpleLightZone ─────────────────────────────────────────────────────────

function FilePiUploadSimpleLightZone({
  caseId, docType, label, accept, companyName, onPiUploadSimpleLighted,
}: {
  caseId: number; docType: string; label: string; accept?: string;
  companyName?: string; onPiUploadSimpleLighted: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [fiscalYear, setFiscalYear] = useState("");
  const uploadDoc = usePiUploadSimpleLightDocument();
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    try {
      await uploadDoc.mutateAsync({ caseId, file, docType, fiscalYear: fiscalYear || undefined, companyName });
      toast({ title: "PiUploadSimpleLighted", description: `${file.name} uploaded and extracted.` });
      onPiUploadSimpleLighted();
    } catch {
      toast({ title: "PiUploadSimpleLight failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-2">
      {docType === "annual_report" && (
        <Input placeholder="Fiscal year (e.g. FY2024)" value={fiscalYear}
          onChange={e => setFiscalYear(e.target.value)} className="h-8 text-sm w-40" />
      )}
      <label
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        <input type="file" className="hidden" accept={accept || ".pdf,.xlsx,.xls,.png,.jpg,.jpeg"}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {uploadDoc.isPending ? (
          <><PiSpinnerLight className="h-6 w-6 animate-spin text-primary mb-2" /><span className="text-sm text-muted-foreground">PiUploadSimpleLighting & extracting…</span></>
        ) : (
          <><PiUploadSimpleLight className="h-6 w-6 text-muted-foreground mb-2" /><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground mt-1">Drop file here or click to browse</span></>
        )}
      </label>
    </div>
  );
}

// ── FinancialsPanel ─────────────────────────────────────────────────────────

function FinancialsPanel({ caseId, companyName, documents, onRefresh }: {
  caseId: number; companyName: string; documents: CaseDocument[]; onRefresh: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [suggestedTicker, setSuggestedTicker] = useState("");
  const fetchReports = useFetchAnnualReports();
  const deleteDoc = useDeleteDocument();
  const { toast } = useToast();

  const annualReports = documents.filter(d => d.doc_type === "annual_report");

  // Auto-search for BSE/NSE ticker on mount when no reports exist
  useEffect(() => {
    if (annualReports.length > 0 || !companyName) return;
    searchCompanies({ q: companyName })
      .then((results: { ticker: string }[]) => {
        if (results && results.length > 0) {
          const ticker = results[0].ticker.replace(/\.(NS|BO)$/, "");
          setSuggestedTicker(ticker);
          setSymbol(ticker);
        }
      })
      .catch(() => {});
  }, [companyName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFetch = async () => {
    if (!symbol.trim()) { toast({ title: "Enter BSE/NSE symbol", variant: "destructive" }); return; }
    try {
      const res = await fetchReports.mutateAsync({ caseId, symbol: symbol.trim(), companyName });
      toast({ title: `${res.reportsFound} report(s) fetched`, description: "Financials extracted and saved." });
      setSuggestedTicker("");
      onRefresh();
    } catch {
      toast({ title: "Fetch failed", description: "Could not find annual reports. Try uploading manually.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Auto-fetch banner when no reports and ticker detected */}
      {annualReports.length === 0 && suggestedTicker && !fetchReports.isPending && (
        <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <PiBuildingsLight className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Listed company detected — {suggestedTicker}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Fetch the last 3 annual reports from BSE/NSE automatically.</p>
          </div>
          <Button size="sm" onClick={handleFetch}>
            <PiMagnifyingGlassLight className="mr-2 h-3.5 w-3.5" /> Fetch Now
          </Button>
        </div>
      )}

      {fetchReports.isPending && (
        <div className="flex items-center gap-3 p-4 bg-muted/30 border rounded-lg">
          <PiSpinnerLight className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Fetching annual reports from BSE/NSE…</p>
            <p className="text-xs text-muted-foreground">Downloading and extracting financials from PDFs. This may take 1–3 minutes.</p>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-2">Fetch Annual Reports (BSE/NSE)</h4>
        <div className="flex gap-2">
          <Input placeholder="BSE/NSE Symbol (e.g. RELIANCE)" value={symbol}
            onChange={e => setSymbol(e.target.value.toUpperCase())} className="max-w-xs"
            onKeyDown={e => e.key === "Enter" && handleFetch()} />
          <Button onClick={handleFetch} disabled={fetchReports.isPending} variant={suggestedTicker ? "default" : "outline"}>
            {fetchReports.isPending
              ? <><PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> Fetching…</>
              : <><PiMagnifyingGlassLight className="mr-2 h-4 w-4" /> Fetch Annual Reports</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Fetches last 3 years from BSE filings portal. Falls back to investor relations page if not found.</p>
      </div>

      {annualReports.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Fetched Reports</h4>
          {annualReports.map(doc => (
            <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
              <div className="flex items-center gap-3">
                <PiFileTextLight className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">{doc.fiscal_year} · {doc.source?.toUpperCase()} · {doc.extracted_data ? "Extracted ✓" : "No extraction"}</p>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                disabled={deleteDoc.isPending}
                onClick={async () => {
                  try {
                    await deleteDoc.mutateAsync({ caseId, docId: doc.id });
                    onRefresh();
                  } catch {
                    toast({ title: "Delete failed", variant: "destructive" });
                  }
                }}>
                <PiTrashLight className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t space-y-3">
        <p className="text-sm text-muted-foreground">Or upload PDFs/Excel manually:</p>
        <FilePiUploadSimpleLightZone caseId={caseId} docType="annual_report" label="PiUploadSimpleLight Annual Report PDF" accept=".pdf" companyName={companyName} onPiUploadSimpleLighted={onRefresh} />
        <FilePiUploadSimpleLightZone caseId={caseId} docType="cma" label="PiUploadSimpleLight CMA Data (Excel)" accept=".xlsx,.xls" companyName={companyName} onPiUploadSimpleLighted={onRefresh} />
      </div>
    </div>
  );
}

// ── ResearchPanel ──────────────────────────────────────────────────────────

function ResearchPanel({ caseId, extractedData, onRefresh }: {
  caseId: number;
  extractedData: DataRoomState["extractedData"];
  onRefresh: () => void;
}) {
  const runResearch = useRunResearch();
  const updatePeers = useUpdatePeers();
  const { data: peersData, refetch: refetchPeers } = useGetPeers(caseId);
  const [newPeerName, setNewPeerName] = useState("");
  const { toast } = useToast();

  const peers: Peer[] = peersData?.peers || [];
  const research = (extractedData?.research || []) as Record<string, unknown>[];

  const handleRunResearch = async () => {
    try {
      const res = await runResearch.mutateAsync({ caseId });
      toast({ title: "Research complete", description: `${res.newItems} new findings added.` });
      onRefresh();
    } catch {
      toast({ title: "Research failed", variant: "destructive" });
    }
  };

  const togglePeer = async (peer: Peer) => {
    try {
      const updated = peers.map(p => p.name === peer.name ? { ...p, confirmed: !p.confirmed } : p);
      await updatePeers.mutateAsync({ caseId, peers: updated });
      refetchPeers();
    } catch {
      toast({ title: "Failed to update peer", variant: "destructive" });
    }
  };

  const addPeer = async () => {
    if (!newPeerName.trim()) return;
    try {
      const updated = [...peers, { name: newPeerName.trim(), confirmed: true }];
      await updatePeers.mutateAsync({ caseId, peers: updated });
      setNewPeerName("");
      refetchPeers();
    } catch {
      toast({ title: "Failed to add peer", variant: "destructive" });
    }
  };

  const removePeer = async (name: string) => {
    try {
      const updated = peers.filter(p => p.name !== name);
      await updatePeers.mutateAsync({ caseId, peers: updated });
      refetchPeers();
    } catch {
      toast({ title: "Failed to remove peer", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button onClick={handleRunResearch} disabled={runResearch.isPending}>
          {runResearch.isPending
            ? <><PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> Running research…</>
            : <><PiArrowClockwiseLight className="mr-2 h-4 w-4" /> Run Research</>}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">PiMagnifyingGlassLightes news, credit ratings, regulatory filings, and promoter records. Re-running appends new findings — old ones are never deleted.</p>
      </div>

      {research.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3">Research Findings ({research.length})</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {research.map((item, i) => {
              const stableKey = (item.id as string | number | undefined) ?? (item.timestamp as string | undefined) ?? i;
              return (
                <div key={stableKey} className="p-3 bg-muted/30 rounded-lg border text-sm">
                  <p className="text-xs text-muted-foreground mb-1">
                    {item.timestamp ? new Date(item.timestamp as string).toLocaleString() : ""}
                  </p>
                  <p className="line-clamp-3">{(item.content || item.brief || JSON.stringify(item).slice(0, 200)) as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-3">Peer Companies</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {peers.map(peer => (
            <div key={peer.name}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors ${peer.confirmed ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-border text-muted-foreground"}`}
              onClick={() => togglePeer(peer)}>
              {peer.confirmed ? <PiCheckCircleLight className="h-3.5 w-3.5" /> : <PiWarningCircleLight className="h-3.5 w-3.5" />}
              {peer.name}
              <button onClick={e => { e.stopPropagation(); removePeer(peer.name); }} className="ml-1 hover:text-destructive">
                <PiXLight className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Add peer company…" value={newPeerName}
            onChange={e => setNewPeerName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPeer()}
            className="max-w-xs h-8 text-sm" />
          <Button size="sm" variant="outline" onClick={addPeer}><PiPlusLight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

// ── DocumentsPanel ─────────────────────────────────────────────────────────

function DocList({ docs, caseId, onRefresh }: { docs: CaseDocument[]; caseId: number; onRefresh: () => void }) {
  const deleteDoc = useDeleteDocument();
  const { toast } = useToast();
  if (docs.length === 0) return null;
  return (
    <div className="space-y-2 mt-2">
      {docs.map(doc => (
        <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border text-sm">
          <span className="truncate">{doc.filename}</span>
          <Button size="sm" variant="ghost" className="text-destructive shrink-0"
            disabled={deleteDoc.isPending}
            onClick={async () => {
              try {
                await deleteDoc.mutateAsync({ caseId, docId: doc.id });
                onRefresh();
              } catch {
                toast({ title: "Delete failed", variant: "destructive" });
              }
            }}>
            <PiTrashLight className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function DocumentsPanel({ caseId, companyName, documents, onRefresh }: {
  caseId: number; companyName: string; documents: CaseDocument[]; onRefresh: () => void;
}) {
  const [manualTree, setManualTree] = useState("");
  const saveTree = useSaveOrganogramTree();
  const { toast } = useToast();

  const organogramDocs = documents.filter(d => d.doc_type === "organogram");
  const securityDocs = documents.filter(d => d.doc_type === "security");
  const kycDocs = documents.filter(d => d.doc_type === "kyc");

  const handleSaveTree = async () => {
    try {
      await saveTree.mutateAsync({ caseId, tree: [], summary: manualTree });
      toast({ title: "Organogram saved" });
      onRefresh();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold mb-3">Group Organogram</h4>
        <FilePiUploadSimpleLightZone caseId={caseId} docType="organogram" label="PiUploadSimpleLight Organogram (PDF or Image)" accept=".pdf,.png,.jpg,.jpeg" companyName={companyName} onPiUploadSimpleLighted={onRefresh} />
        <DocList docs={organogramDocs} caseId={caseId} onRefresh={onRefresh} />
        <div className="mt-3">
          <p className="text-xs text-muted-foreground mb-1">Or describe the group structure manually:</p>
          <Textarea placeholder="Parent: ABC Holdings (100%) → Subsidiary: XYZ Ltd (51%), Associate: PQR Co (26%)…"
            value={manualTree} onChange={e => setManualTree(e.target.value)} className="min-h-[100px] text-sm" />
          <Button size="sm" className="mt-2" onClick={handleSaveTree} disabled={!manualTree.trim() || saveTree.isPending}>
            {saveTree.isPending ? <PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" /> : null}Save Structure
          </Button>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-3">Security Documents</h4>
        <FilePiUploadSimpleLightZone caseId={caseId} docType="security" label="PiUploadSimpleLight Valuation Report / Charge Document" accept=".pdf" companyName={companyName} onPiUploadSimpleLighted={onRefresh} />
        <DocList docs={securityDocs} caseId={caseId} onRefresh={onRefresh} />
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-1">KYC / Promoter Docs <span className="text-xs text-muted-foreground font-normal">(optional)</span></h4>
        <FilePiUploadSimpleLightZone caseId={caseId} docType="kyc" label="PiUploadSimpleLight PAN / Promoter CV (optional)" accept=".pdf,.png,.jpg" companyName={companyName} onPiUploadSimpleLighted={onRefresh} />
        <DocList docs={kycDocs} caseId={caseId} onRefresh={onRefresh} />
      </div>
    </div>
  );
}

// ── SummaryPanel ───────────────────────────────────────────────────────────

function SummaryPanel({ completeness, documents, extractedData }: {
  completeness: number;
  documents: CaseDocument[];
  extractedData: DataRoomState["extractedData"];
}) {
  const confirmedPeers = ((extractedData?.peers || []) as Peer[]).filter(p => p.confirmed);
  const rows = [
    { label: "Annual Reports", status: documents.some(d => d.doc_type === "annual_report") ? "ok" : "missing", detail: documents.filter(d => d.doc_type === "annual_report").map(d => d.fiscal_year || d.filename).join(", ") || "Not fetched" },
    { label: "Research & News", status: (extractedData?.research?.length || 0) > 0 ? "ok" : "missing", detail: `${extractedData?.research?.length || 0} finding(s)` },
    { label: "Peer Companies", status: confirmedPeers.length > 0 ? "ok" : "missing", detail: confirmedPeers.map(p => p.name).join(", ") || "None confirmed" },
    { label: "Group Organogram", status: documents.some(d => d.doc_type === "organogram") || extractedData?.organogram ? "ok" : "missing", detail: documents.some(d => d.doc_type === "organogram") ? "PiUploadSimpleLighted" : extractedData?.organogram ? "Manual entry" : "Not provided" },
    { label: "Security Documents", status: documents.some(d => d.doc_type === "security") ? "ok" : "optional", detail: `${documents.filter(d => d.doc_type === "security").length} doc(s)` },
    { label: "KYC / Promoter Docs", status: "optional" as const, detail: documents.some(d => d.doc_type === "kyc") ? "PiUploadSimpleLighted" : "Not uploaded" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm font-medium mb-2"><span>Data Completeness</span><span>{completeness}%</span></div>
        <Progress value={completeness} className="h-3" />
        <p className="text-xs text-muted-foreground mt-1">Higher completeness = richer AI-generated CAM sections</p>
      </div>
      <div className="divide-y">
        {rows.map(row => (
          <div key={row.label} className="py-3 flex items-center justify-between">
            <div><p className="text-sm font-medium">{row.label}</p><p className="text-xs text-muted-foreground">{row.detail}</p></div>
            <StatusBadge status={row.status as "ok" | "missing" | "optional"} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main DataRoomTab ───────────────────────────────────────────────────────

type DataRoomPanel = "financials" | "research" | "documents" | "summary";

export default function DataRoomTab({ caseId, companyName }: { caseId: number; companyName: string }) {
  const [activePanel, setActivePanel] = useState<DataRoomPanel>("financials");
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useGetDataRoom(caseId);

  const handleRefresh = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: getDataRoomQueryKey(caseId) });
  };

  if (isLoading) return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
    </div>
  );

  const { documents = [], extractedData = null, completeness = 0 } = data || {};

  const panels = [
    { key: "financials" as const, label: "Financials", icon: PiBuildingsLight },
    { key: "research" as const, label: "Research & News", icon: PiNewspaperLight },
    { key: "documents" as const, label: "Documents", icon: PiFolderOpenLight },
    { key: "summary" as const, label: `Summary · ${completeness}%`, icon: PiCheckCircleLight },
  ];

  return (
    <div className="flex h-full">
      <div className="w-48 shrink-0 border-r bg-muted/10 p-3 space-y-1">
        {panels.map(p => (
          <button key={p.key} onClick={() => setActivePanel(p.key)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${activePanel === p.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
            <p.icon className="h-4 w-4 shrink-0" />{p.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activePanel === "financials" && <FinancialsPanel caseId={caseId} companyName={companyName} documents={documents} onRefresh={handleRefresh} />}
        {activePanel === "research" && <ResearchPanel caseId={caseId} extractedData={extractedData} onRefresh={handleRefresh} />}
        {activePanel === "documents" && <DocumentsPanel caseId={caseId} companyName={companyName} documents={documents} onRefresh={handleRefresh} />}
        {activePanel === "summary" && <SummaryPanel completeness={completeness} documents={documents} extractedData={extractedData} />}
      </div>
    </div>
  );
}
