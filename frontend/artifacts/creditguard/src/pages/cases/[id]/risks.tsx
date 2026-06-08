import { useParams, Link } from "wouter";
import { 
  useGetCase, 
  useListRiskFlags,
  getGetCaseQueryKey,
  getListRiskFlagsQueryKey,
  RiskFlag
} from "@workspace/api-client-react";
import {
  PiPiArrowLeftLightLight,
  PiWarningLight,
  PiShieldWarningLight,
  PiPiShieldCheckLightLight,
  PiCaretRightLight,
  PiPiInfoLightLight,
} from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownView } from "@/components/markdown-view";

export default function CaseRisks() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { toast } = useToast();

  const { data: caseData, isLoading: caseLoading } = useGetCase(id, {
    query: { enabled: !!id, queryKey: getGetCaseQueryKey(id) }
  });

  const { data: riskFlags, isLoading: riskLoading } = useListRiskFlags(id, {
    query: { enabled: !!id, queryKey: getListRiskFlagsQueryKey(id) }
  });

  // Acknowledgment is session-only — backend persistence is pending an updateRiskFlag endpoint.
  const [acknowledgedRisks, setAcknowledgedRisks] = useState<Set<number>>(new Set());

  const handleAcknowledge = (riskId: number) => {
    const wasAcknowledged = acknowledgedRisks.has(riskId);
    setAcknowledgedRisks(prev => {
      const next = new Set(prev);
      if (wasAcknowledged) next.delete(riskId);
      else next.add(riskId);
      return next;
    });
    toast({
      title: wasAcknowledged ? "Acknowledgment removed" : "Risk acknowledged",
      description: "Note: this is session-only and won't persist after refresh.",
    });
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return <Badge className="bg-red-500 text-white hover:bg-red-600"><PiWarningLight className="mr-1 h-3 w-3" /> High Risk</Badge>;
      case 'medium':
        return <Badge className="bg-amber-500 text-white hover:bg-amber-600">Medium Risk</Badge>;
      case 'low':
        return <Badge className="bg-blue-500 text-white hover:bg-blue-600">Low Risk</Badge>;
      default:
        return <Badge>{severity}</Badge>;
    }
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-500 bg-muted/10">
      {/* Top Header */}
      <div className="bg-background border-b px-8 py-5 shrink-0 sticky top-0 z-20">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Link href="/cases" className="hover:text-foreground transition-colors flex items-center gap-1">
            <PiArrowLeftLight className="h-3 w-3" /> Cases
          </Link>
          <PiCaretRightLight className="h-3 w-3" />
          <Link href={`/cases/${id}`} className="hover:text-foreground transition-colors">
            {caseData?.borrowerName || "Loading..."}
          </Link>
          <PiCaretRightLight className="h-3 w-3" />
          <span className="text-foreground font-medium">Risk Review</span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl tracking-[-0.02em] text-foreground flex items-center gap-3">
              <PiShieldWarningLight className="h-6 w-6 text-primary" />
              Risk Review Board
            </h1>
            <p className="text-muted-foreground mt-1">
              Analyze and mitigate key risks identified by the AI co-pilot.
            </p>
          </div>
          
          <Button variant="outline" asChild>
            <Link href={`/cases/${id}`}>Return to Memo Editor</Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto">
          {riskLoading ? (
            <div className="space-y-6">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : riskFlags && riskFlags.length > 0 ? (
            <div className="space-y-6 pb-12">
              <div className="grid grid-cols-3 gap-4 mb-8">
                <Card className="bg-red-50/50 border-red-100">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-lg shrink-0">
                      {riskFlags.filter(r => r.severity === 'high').length}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-900">High Severity</p>
                      <p className="text-xs text-red-700/80">Requires immediate attention</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50/50 border-amber-100">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold text-lg shrink-0">
                      {riskFlags.filter(r => r.severity === 'medium').length}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-amber-900">Medium Severity</p>
                      <p className="text-xs text-amber-700/80">Monitor closely</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-blue-50/50 border-blue-100">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg shrink-0">
                      {riskFlags.filter(r => r.severity === 'low').length}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-900">Low Severity</p>
                      <p className="text-xs text-blue-700/80">Standard operational</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Sort risk flags by severity (high -> medium -> low) */}
              {riskFlags
                .sort((a, b) => {
                  const order = { high: 0, medium: 1, low: 2 };
                  return order[a.severity] - order[b.severity];
                })
                .map((risk) => {
                  const isAcknowledged = acknowledgedRisks.has(risk.id) || risk.isAcknowledged;
                  
                  return (
                    <Card 
                      key={risk.id} 
                      className={`transition-all duration-300 ${
                        isAcknowledged ? 'border-emerald-200 bg-emerald-50/30' : 
                        risk.severity === 'high' ? 'border-red-200 shadow-sm' : ''
                      }`}
                    >
                      <CardHeader className="pb-3 border-b bg-muted/10">
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-3">
                              {getSeverityBadge(risk.severity)}
                              <CardTitle className="text-lg">{risk.riskType}</CardTitle>
                            </div>
                          </div>
                          {isAcknowledged && (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                              <PiShieldCheckLight className="h-3 w-3 mr-1" /> Mitigated
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 grid md:grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-sm font-semibold mb-2 text-muted-foreground flex items-center gap-1.5">
                            <PiInfoLight className="h-4 w-4" /> Risk Description
                          </h4>
                          <MarkdownView content={risk.description} className="text-sm" />
                        </div>

                        {risk.mitigation && (
                          <div className="bg-background rounded-md border p-4 shadow-sm">
                            <h4 className="text-sm font-semibold mb-2 text-primary flex items-center gap-1.5">
                              <PiShieldCheckLight className="h-4 w-4" /> AI Suggested Mitigation
                            </h4>
                            <MarkdownView content={risk.mitigation} className="text-sm text-muted-foreground" />
                          </div>
                        )}
                      </CardContent>
                      <CardFooter className="bg-muted/10 border-t py-3 flex justify-end">
                        <Button 
                          variant={isAcknowledged ? "outline" : "default"} 
                          className={!isAcknowledged && risk.severity === 'high' ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                          onClick={() => handleAcknowledge(risk.id)}
                        >
                          {isAcknowledged ? "Undo Acknowledgment" : "Acknowledge & Apply Mitigation"}
                        </Button>
                      </CardFooter>
                    </Card>
                  );
              })}
            </div>
          ) : (
            <div className="text-center py-20 text-muted-foreground bg-background rounded-lg border border-dashed">
              <PiShieldCheckLight className="mx-auto h-12 w-12 text-emerald-500 mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-1">No Risks Detected</h3>
              <p>The AI co-pilot did not flag any significant risks for this case.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}