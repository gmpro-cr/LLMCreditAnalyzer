import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCases,
  useDeleteCase,
  getListCasesQueryKey,
  CaseStatus
} from "@workspace/api-client-react";
import {
  PiMagnifyingGlassLight,
  PiFunnelLight,
  PiDotsThreeLight,
  PiFileTextLight,
  PiClockLight,
  PiCheckCircleLight,
  PiXCircleLight,
  PiWarningCircleLight,
  PiTrashLight,
} from "react-icons/pi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCr, formatDate, caseRef, facilityLabel } from "@/lib/format";
import { StatusChip } from "@/components/status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { OutageState } from "@/components/outage-state";
import { isDataUnavailable } from "@/lib/query-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";

export default function CasesList() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const [statusFilter, setStatusFilter] = useState<string>(
    () => new URLSearchParams(search).get("status") ?? "all"
  );

  const handleStatusChange = (next: string) => {
    setStatusFilter(next);
    const params = new URLSearchParams(search);
    if (next === "all") params.delete("status");
    else params.set("status", next);
    const qs = params.toString();
    setLocation(qs ? `/cases?${qs}` : "/cases", { replace: true });
  };
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>("");

  const queryParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as CaseStatus } : {})
  };

  const { data: cases, isLoading, isError, refetch, isFetching } = useListCases(queryParams, {
    query: { queryKey: getListCasesQueryKey(queryParams) }
  });

  const casesUnavailable = isDataUnavailable(isError, isLoading, cases);

  const deleteCase = useDeleteCase();

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteCase.mutateAsync({ id: deleteConfirmId });
      queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
      toast({ title: "Case deleted", description: `${deleteConfirmName} has been removed.` });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete the case.", variant: "destructive" });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  return (
    <>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] leading-tight">Cases</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every credit appraisal memorandum in this workspace.</p>
          </div>
          <Button onClick={() => setLocation("/cases/new")}>New case</Button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
          <div className="relative flex-1 max-w-md">
            <PiMagnifyingGlassLight className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search borrower, RM or PAN"
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-[180px]">
                <PiFunnelLight className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_review">Credit review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Returned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-hidden rounded border border-border bg-card">
          <div className="relative w-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="h-10 px-4 text-left font-medium">Reference</th>
                  <th className="h-10 px-4 text-left font-medium">Borrower</th>
                  <th className="h-10 px-4 text-left font-medium">Facility</th>
                  <th className="h-10 px-4 text-right font-medium">Amount</th>
                  <th className="h-10 px-4 text-left font-medium">Status</th>
                  <th className="h-10 px-4 text-right font-medium">Sections reviewed</th>
                  <th className="h-10 px-4 text-left font-medium">RM</th>
                  <th className="h-10 px-4 text-left font-medium">Opened</th>
                  <th className="h-10 w-[50px] px-4"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b transition-colors">
                      <td className="p-4 align-middle"><Skeleton className="h-5 w-[200px]" /></td>
                      <td className="p-4 align-middle"><Skeleton className="h-5 w-[120px]" /></td>
                      <td className="p-4 align-middle text-right"><Skeleton className="h-5 w-[100px] ml-auto" /></td>
                      <td className="p-4 align-middle"><Skeleton className="h-6 w-[80px] rounded-full" /></td>
                      <td className="p-4 align-middle"><Skeleton className="h-2 w-[100px]" /></td>
                      <td className="p-4 align-middle"><Skeleton className="h-5 w-[120px]" /></td>
                      <td className="p-4 align-middle"><Skeleton className="h-5 w-[80px]" /></td>
                      <td className="p-4 align-middle"><Skeleton className="h-8 w-8 rounded-md" /></td>
                    </tr>
                  ))
                ) : casesUnavailable ? (
                  // Must come before the empty branch: a failed read is not an
                  // empty portfolio, and saying "No cases yet" here would be a
                  // false statement about the user's book.
                  <tr>
                    <td colSpan={9} className="h-48 text-center">
                      <OutageState
                        description="Your cases are safe — we just can't load them right now. This usually clears on its own in a few minutes."
                        onRetry={() => refetch()}
                        isRetrying={isFetching}
                        compact
                      />
                    </td>
                  </tr>
                ) : cases && cases.length > 0 ? (
                  cases.map((c) => (
                    <tr
                      key={c.id}
                      className="group cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/60"
                      onClick={() => setLocation(`/cases/${c.id}`)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 align-middle font-mono text-xs text-muted-foreground">{caseRef(c.id, c.createdAt)}</td>
                      <td className="px-4 py-3 align-middle">
                        <a href={`/cases/${c.id}`} onClick={(e) => { e.preventDefault(); setLocation(`/cases/${c.id}`); }} className="font-medium text-foreground hover:text-primary">{c.borrowerName}</a>
                        <div className="mt-0.5 text-xs text-muted-foreground">{c.sector}</div>
                      </td>
                      <td className="px-4 py-3 align-middle text-muted-foreground">{facilityLabel(c.facilityType)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-middle tabular-nums">{formatCr(c.facilityAmount)}</td>
                      <td className="px-4 py-3 align-middle"><StatusChip status={c.status} /></td>
                      <td className="px-4 py-3 text-right align-middle text-xs tabular-nums text-muted-foreground">{c.memoProgress}%</td>
                      <td className="px-4 py-3 align-middle text-muted-foreground">{c.rmName}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-middle text-muted-foreground">{formatDate(c.createdAt)}</td>
                      <td className="px-4 py-3 align-middle" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                              <span className="sr-only">Actions for {c.borrowerName}</span>
                              <PiDotsThreeLight className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-[160px]">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setLocation(`/cases/${c.id}`)}>
                              Open memo
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLocation(`/cases/${c.id}/risks`)}>
                              View risks
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => { setDeleteConfirmId(c.id); setDeleteConfirmName(c.borrowerName); }}
                            >
                              <PiTrashLight className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="h-48 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <PiFileTextLight className="h-10 w-10 opacity-20" />
                        {(debouncedSearch || statusFilter !== "all") ? (
                          <>
                            <p className="text-sm">No cases match your filters.</p>
                            <Button variant="outline" size="sm" onClick={() => { setSearchQuery(""); handleStatusChange("all"); }}>
                              Clear filters
                            </Button>
                          </>
                        ) : (
                          <>
                            <div>
                              <p className="text-sm font-medium text-foreground">No cases yet</p>
                              <p className="text-xs mt-1">Create your first credit appraisal memorandum to get started.</p>
                            </div>
                            <Button size="sm" onClick={() => setLocation("/cases/new")}>
                              New case
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteConfirmId !== null} onOpenChange={open => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this case?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteConfirmName}</strong>? This will permanently remove the case, all memo sections, documents, and activity history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {deleteCase.isPending ? "Deleting…" : "Delete case"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
