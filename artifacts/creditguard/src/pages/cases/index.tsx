import { useState } from "react";
import { Link } from "wouter";
import { 
  useListCases, 
  getListCasesQueryKey,
  CaseStatus 
} from "@workspace/api-client-react";
import { 
  Search, 
  Filter,
  MoreHorizontal,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";

export default function CasesList() {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const queryParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter as CaseStatus } : {})
  };

  const { data: cases, isLoading } = useListCases(queryParams, { 
    query: { queryKey: getListCasesQueryKey(queryParams) } 
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"><CheckCircle2 className="mr-1 h-3 w-3" /> Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20"><XCircle className="mr-1 h-3 w-3" /> Rejected</Badge>;
      case 'in_review':
        return <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20"><AlertCircle className="mr-1 h-3 w-3" /> In Review</Badge>;
      case 'draft':
      default:
        return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-500/20"><Clock className="mr-1 h-3 w-3" /> Draft</Badge>;
    }
  };

  const getFacilityTypeLabel = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cases</h1>
          <p className="text-muted-foreground mt-1">Manage and track credit appraisal memorandums.</p>
        </div>
        <Link href="/cases/new" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
          <FileText className="mr-2 h-4 w-4" />
          New CAM Request
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by borrower, RM name or PAN..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-md bg-card flex-1 overflow-auto">
        <div className="relative w-full overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className="[&_tr]:border-b sticky top-0 bg-muted/50 z-10 backdrop-blur-sm">
              <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Borrower</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Facility</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground text-right">Amount</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Progress</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">RM Name</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Created</th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[50px]"></th>
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
              ) : cases && cases.length > 0 ? (
                cases.map((c) => (
                  <tr key={c.id} className="border-b transition-colors hover:bg-muted/30 group">
                    <td className="p-4 align-middle font-medium">
                      <Link href={`/cases/${c.id}`} className="hover:underline text-primary">
                        {c.borrowerName}
                      </Link>
                      <div className="text-xs text-muted-foreground font-normal mt-0.5">{c.sector}</div>
                    </td>
                    <td className="p-4 align-middle text-muted-foreground">
                      {getFacilityTypeLabel(c.facilityType)}
                    </td>
                    <td className="p-4 align-middle text-right font-medium">
                      {formatCurrency(c.facilityAmount)}
                    </td>
                    <td className="p-4 align-middle">
                      {getStatusBadge(c.status)}
                    </td>
                    <td className="p-4 align-middle">
                      <div className="flex items-center gap-2 w-[120px]">
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all" 
                            style={{ width: `${c.memoProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{c.memoProgress}%</span>
                      </div>
                    </td>
                    <td className="p-4 align-middle text-muted-foreground">
                      {c.rmName}
                    </td>
                    <td className="p-4 align-middle text-muted-foreground whitespace-nowrap">
                      {formatDate(c.createdAt)}
                    </td>
                    <td className="p-4 align-middle">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[160px]">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href={`/cases/${c.id}`}>View Details</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/cases/${c.id}`}>Edit Memo</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/cases/${c.id}/risks`}>View Risks</Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <FileText className="h-8 w-8 opacity-20 mb-2" />
                      <p>No cases found matching your criteria.</p>
                      <Button variant="link" onClick={() => {setSearchQuery(""); setStatusFilter("all");}} className="mt-2">
                        Clear filters
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}