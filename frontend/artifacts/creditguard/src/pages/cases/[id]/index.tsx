import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "wouter";
import {
  useGetCase,
  useUpdateCase,
  useListSections,
  useUpdateSection,
  useListRiskFlags,
  useGenerateMemo,
  getGetCaseQueryKey,
  getListSectionsQueryKey,
  getListRiskFlagsQueryKey,
  MemoSection
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import DataRoomTab from "./DataRoomTab";
import DrawingPowerCalculator from "./DrawingPowerCalculator";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  Lock,
  Unlock,
  ShieldAlert,
  ChevronRight,
  Eye,
  MoreVertical,
  Download,
  Sparkles,
  RefreshCw,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown-view";

const CONFIDENCE_COLORS = {
  high: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  low: "bg-red-500/10 text-red-600 border-red-500/20",
  pending: "bg-blue-500/10 text-blue-600 border-blue-500/20",
};

function EditorSection({
  section,
  caseId,
  onSave,
  dpProps,
}: {
  section: MemoSection;
  caseId: number;
  onSave: (id: number, key: string, data: Partial<Pick<MemoSection, "content" | "isReviewed" | "isLocked">>) => Promise<void>;
  dpProps?: React.ComponentProps<typeof DrawingPowerCalculator>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(section.content);
  const { toast } = useToast();

  // Sync content from props only when not actively editing (avoid clobbering user input)
  useEffect(() => {
    if (!isEditing) setContent(section.content);
  }, [section.content, isEditing]);

  const handleSave = async () => {
    try {
      await onSave(caseId, section.sectionKey, { content });
      setIsEditing(false);
      toast({ title: "Section saved", description: "Your changes have been saved." });
    } catch (e) {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  };

  const toggleReview = async () => {
    try {
      await onSave(caseId, section.sectionKey, { isReviewed: !section.isReviewed });
    } catch (e) {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const toggleLock = async () => {
    try {
      await onSave(caseId, section.sectionKey, { isLocked: !section.isLocked });
    } catch (e) {
      toast({ title: "Failed to update lock status", variant: "destructive" });
    }
  };

  return (
    <Card className={`scroll-mt-20 overflow-hidden border ${section.isReviewed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'} transition-colors duration-300`} id={`section-${section.sectionKey}`}>
      <CardHeader className="bg-muted/40 pb-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-xl tracking-tight">{section.sectionTitle}</h3>
            {section.confidence !== 'pending' && (
              <Badge variant="outline" className={`${CONFIDENCE_COLORS[section.confidence]} font-medium uppercase text-[10px] tracking-wider`}>
                {section.confidence} confidence
              </Badge>
            )}
            {section.isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            <Button 
              size="sm" 
              variant="outline" 
              className={section.isReviewed ? "text-emerald-600 border-emerald-200 hover:bg-emerald-50" : ""}
              onClick={toggleReview}
            >
              <CheckCircle2 className={`mr-1.5 h-4 w-4 ${section.isReviewed ? "text-emerald-500" : "text-muted-foreground"}`} />
              {section.isReviewed ? "Reviewed" : "Mark Reviewed"}
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={toggleLock}
              className="px-2"
            >
              {section.isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4 text-muted-foreground" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isEditing && !section.isLocked ? (
          <div className="flex flex-col bg-background">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); handleSave(); }
                if (e.key === "Escape") { setContent(section.content); setIsEditing(false); }
              }}
              className="min-h-[240px] border-0 focus-visible:ring-0 rounded-none resize-y p-6 leading-relaxed bg-transparent font-mono text-sm"
              placeholder="Markdown supported — **bold**, lists, tables, etc."
              autoFocus
            />
            <div className="flex items-center justify-between gap-2 p-3 bg-muted/20 border-t">
              <span className="text-xs text-muted-foreground">
                <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">⌘S</kbd> save · <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">Esc</kbd> cancel
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setContent(section.content); setIsEditing(false); }}>Cancel</Button>
                <Button size="sm" onClick={handleSave}>Save Changes</Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`p-6 ${!section.isLocked ? "cursor-text hover:bg-muted/10" : "opacity-80"} transition-colors`}
            onClick={() => !section.isLocked && setIsEditing(true)}
          >
            {content ? (
              <MarkdownView content={content} />
            ) : (
              <span className="text-muted-foreground italic">No content generated yet. Click to start writing.</span>
            )}
          </div>
        )}
        {dpProps && (
          <div className="p-6 pt-0">
            <DrawingPowerCalculator {...dpProps} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}


export default function CaseDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: caseData, isLoading: caseLoading } = useGetCase(id, {
    query: { enabled: !!id, queryKey: getGetCaseQueryKey(id) }
  });

  const { data: sections, isLoading: sectionsLoading } = useListSections(id, {
    query: { enabled: !!id, queryKey: getListSectionsQueryKey(id) }
  });

  const { data: riskFlags, isLoading: riskLoading } = useListRiskFlags(id, {
    query: { enabled: !!id, queryKey: getListRiskFlagsQueryKey(id) }
  });

  const updateSection = useUpdateSection();
  const updateCase = useUpdateCase();
  const generateMemo = useGenerateMemo();
  const [generating, setGenerating] = useState(false);
  const [mainTab, setMainTab] = useState<"memo" | "dataroom">("memo");

  const hasContent = sections?.some(s => s.content && s.content.trim().length > 0);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateMemo.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListSectionsQueryKey(id) });
      await queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
      toast({ title: "Memo generated", description: "All sections have been drafted by AI." });
    } catch (e) {
      toast({ title: "Generation failed", description: "Could not reach the AI service. Try again.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateSection = useCallback(async (caseId: number, sectionKey: string, data: Partial<Pick<MemoSection, "content" | "isReviewed" | "isLocked">>) => {
    await updateSection.mutateAsync({ id: caseId, sectionKey, data });
    // Patch local cache to avoid full refetch bounce
    queryClient.setQueryData(getListSectionsQueryKey(caseId), (old: MemoSection[] | undefined) => {
      if (!old) return old;
      return old.map(s => s.sectionKey === sectionKey ? { ...s, ...data } : s);
    });
  }, [updateSection, queryClient]);

  const handleStatusChange = async (newStatus: "draft" | "in_review" | "approved" | "rejected") => {
    try {
      await updateCase.mutateAsync({ id, data: { status: newStatus } });
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
      toast({ title: "Status updated", description: `Case moved to ${newStatus.replace('_', ' ')}` });
    } catch (e) {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const getFacilityTypeLabel = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const highSeverityRisksCount = riskFlags?.filter(r => r.severity === 'high').length || 0;

  if (caseLoading || !caseData) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-4 gap-6 mt-8">
          <div className="col-span-3 space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="col-span-1">
            <Skeleton className="h-[400px] w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-500 bg-muted/20">
      {/* Top Header */}
      <div className="bg-background border-b px-8 py-4 shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Link href="/cases" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Cases
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">{caseData.borrowerName}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground truncate">{caseData.borrowerName}</h1>
            <div className="flex items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {getFacilityTypeLabel(caseData.facilityType)}</span>
              <span>{formatCurrency(caseData.facilityAmount)}</span>
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {formatDate(caseData.createdAt)}</span>
              {caseData.cin && <span className="font-mono">CIN: {caseData.cin}</span>}
              <span className="flex items-center gap-2">
                <span>Progress {caseData.memoProgress}%</span>
                <Progress value={caseData.memoProgress} className="h-1.5 w-20" />
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              title={hasContent ? "Re-generate all sections with AI" : "Generate all sections with AI"}
            >
              {generating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
              ) : hasContent ? (
                <><RefreshCw className="mr-2 h-4 w-4" /> Re-generate</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Generate AI Draft</>
              )}
            </Button>

            <Button variant="outline" size="sm" asChild>
              <a
                href={`${import.meta.env.VITE_API_URL || ""}/api/cases/${id}/export-pdf`}
                download={`CAM_${caseData.borrowerName}.pdf`}
              >
                <Download className="mr-2 h-4 w-4" /> Export PDF
              </a>
            </Button>

            {caseData.status === 'draft' && (
              <Button size="sm" onClick={() => handleStatusChange('in_review')} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                Submit for Review
              </Button>
            )}
            {caseData.status === 'in_review' && (
              <>
                <Button size="sm" variant="outline" onClick={() => handleStatusChange('rejected')} className="text-red-600 border-red-200 hover:bg-red-50">
                  Reject
                </Button>
                <Button size="sm" onClick={() => handleStatusChange('approved')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Approve Memo
                </Button>
              </>
            )}
            {caseData.status === 'approved' && (
              <Badge className="bg-emerald-500 text-white px-3 py-1.5 text-sm"><CheckCircle2 className="mr-1.5 h-4 w-4" /> Approved</Badge>
            )}
          </div>
        </div>
        
        {/* Main tab bar */}
        <div className="mt-3 flex gap-1 border-b -mb-px">
          {(["memo", "dataroom"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setMainTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {tab === "memo" ? "CAM Memo" : "Data Room"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {mainTab === "dataroom" ? (
          <DataRoomTab caseId={id} companyName={caseData.borrowerName} />
        ) : (
        <div className="h-full flex flex-col lg:flex-row">
          {/* Main Editor Area */}
          <div className="flex-1 overflow-y-auto p-8 lg:pr-4 relative scroll-smooth" id="editor-container">
            <div className="max-w-4xl mx-auto space-y-8 pb-20">
              {sectionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-64 w-full" />
                ))
              ) : sections && sections.length > 0 ? (
                sections.map((section) => (
                  <EditorSection
                    key={section.id}
                    section={section}
                    caseId={id}
                    onSave={handleUpdateSection}
                    dpProps={
                      // Drawing Power (Tandon Method II) applies only to working-capital
                      // style limits — never to term loans / LC / BG.
                      (caseData.facilityType === "working_capital" || caseData.facilityType === "overdraft") &&
                      (section.sectionKey === "proposed_structure" || section.sectionKey === "working_capital_analysis")
                        ? {
                            proposedLimit: Math.round((caseData.facilityAmount ?? 0) / 1e7), // rupees → crore
                          }
                        : undefined
                    }
                  />
                ))
              ) : (
                <div className="text-center py-20 text-muted-foreground">
                  <p>No sections generated yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar - Risks & Nav */}
          <div className="w-full lg:w-80 border-l bg-background overflow-y-auto shrink-0 hidden lg:block">
            <div className="p-6">
              <div className="mb-8">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-4">Risk Flags</h3>
                <Card className={`border ${highSeverityRisksCount > 0 ? 'border-red-200' : ''}`}>
                  <CardHeader className={`p-4 pb-2 ${highSeverityRisksCount > 0 ? 'bg-red-50' : ''}`}>
                    <CardTitle className="text-base flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <ShieldAlert className={`h-4 w-4 ${highSeverityRisksCount > 0 ? 'text-red-500' : 'text-amber-500'}`} />
                        Summary
                      </span>
                      {riskLoading ? (
                        <Skeleton className="h-5 w-8" />
                      ) : (
                        <Badge variant={highSeverityRisksCount > 0 ? "destructive" : "secondary"}>
                          {riskFlags?.length || 0} found
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    {riskLoading ? (
                      <div className="space-y-2 mt-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    ) : riskFlags && riskFlags.length > 0 ? (
                      <div className="space-y-3 mt-2">
                        {riskFlags.slice(0, 3).map((risk) => (
                          <div key={risk.id} className="text-sm">
                            <div className="flex items-center gap-1.5 font-medium mb-1">
                              <span className={`h-2 w-2 rounded-full ${
                                risk.severity === 'high' ? 'bg-red-500' : 
                                risk.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                              }`} />
                              {risk.riskType}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 pl-3.5">{risk.description}</p>
                          </div>
                        ))}
                        {riskFlags.length > 3 && (
                          <Button variant="link" size="sm" className="px-0 text-primary h-auto pt-2" asChild>
                            <Link href={`/cases/${id}/risks`}>View all {riskFlags.length} risks →</Link>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-2">No risk flags detected.</p>
                    )}
                  </CardContent>
                  <div className="p-3 border-t bg-muted/30">
                    <Button variant="secondary" className="w-full" asChild>
                      <Link href={`/cases/${id}/risks`}>Open Risk Review</Link>
                    </Button>
                  </div>
                </Card>
              </div>

              <div>
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-4">Navigation</h3>
                <nav className="space-y-1 relative border-l-2 border-border ml-2 pl-4">
                  {sectionsLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-full mb-2" />
                    ))
                  ) : sections?.map((section) => (
                    <a 
                      key={section.id} 
                      href={`#section-${section.sectionKey}`}
                      className="block py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors line-clamp-1 relative group"
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(`section-${section.sectionKey}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      <div className={`absolute -left-[21px] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full border-2 border-background transition-colors ${
                        section.isReviewed ? 'bg-emerald-500' : 
                        section.confidence === 'pending' ? 'bg-muted-foreground' : 'bg-primary'
                      } opacity-0 group-hover:opacity-100`} />
                      {section.isReviewed && <CheckCircle2 className="inline h-3 w-3 text-emerald-500 mr-1.5 -mt-0.5" />}
                      {section.sectionTitle}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}