import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Sparkles,
  ArrowLeft,
  Building2,
  UserCircle,
  Briefcase,
  FileSignature,
  Search,
  Globe,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  Loader2,
  X,
  ChevronRight,
  Database,
} from "lucide-react";
import {
  useCreateCase,
  useGenerateMemo,
  useFetchAnnualReports,
  useRunResearch,
  CreateCaseBodyFacilityType,
  searchCompanies,
  getCompanyPublicData,
  CompanySuggestion,
  CompanyPublicData,
} from "@workspace/api-client-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";

const formSchema = z.object({
  borrowerName: z.string().min(2, "Borrower name must be at least 2 characters"),
  cin: z.string().optional(),
  pan: z.string().optional(),
  facilityType: z.enum([
    "term_loan",
    "working_capital",
    "letter_of_credit",
    "bank_guarantee",
    "overdraft",
  ]),
  facilityAmount: z.coerce.number().min(100000, "Amount must be at least 1,00,000"),
  sector: z.string().min(2, "Sector is required"),
  rmName: z.string().min(2, "RM Name is required"),
});

function fmt(v: number | undefined | null, unit = "₹ Cr") {
  if (v == null) return "—";
  return `${v.toLocaleString("en-IN")} ${unit}`;
}

function pct(v: number | undefined | null) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}%`;
}

function MetricPill({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium whitespace-nowrap">
        {label}
      </span>
      <span className="text-sm font-semibold font-mono tabular-nums">
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function NewCase() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const createCase = useCreateCase();
  const generateMemo = useGenerateMemo();
  const fetchAnnualReports = useFetchAnnualReports();
  const runResearch = useRunResearch();

  const [setupStep, setSetupStep] = useState<string>("");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      borrowerName: "",
      cin: "",
      pan: "",
      facilityType: "term_loan",
      facilityAmount: 10000000,
      sector: "",
      rmName: "",
    },
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CompanyPublicData | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setSuggestions([]);
      setIsSuggestionsOpen(false);
      return;
    }
    setIsSearching(true);
    searchCompanies({ q: debouncedQuery })
      .then((data) => {
        setSuggestions(data ?? []);
        setIsSuggestionsOpen(true);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setIsSearching(false));
  }, [debouncedQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSelectCompany(suggestion: CompanySuggestion) {
    setIsSuggestionsOpen(false);
    setSearchQuery(suggestion.name);
    setIsFetchingData(true);
    setSelectedCompany(null);

    try {
      const data = await getCompanyPublicData({ ticker: suggestion.ticker });
      setSelectedCompany(data);

      form.setValue("borrowerName", data.name || suggestion.name, {
        shouldValidate: true,
      });
      if (data.sector) {
        form.setValue("sector", data.industry || data.sector, {
          shouldValidate: true,
        });
      }
      if (data.cin) {
        form.setValue("cin", data.cin);
      }

      toast({
        title: "Public data loaded",
        description: `Fetched financials for ${data.name} from ${data.dataSource}.`,
      });
    } catch {
      toast({
        title: "Could not fetch data",
        description: "Falling back to manual entry. You can still proceed.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingData(false);
    }
  }

  function clearCompany() {
    setSelectedCompany(null);
    setSearchQuery("");
    setSuggestions([]);
    form.setValue("borrowerName", "");
    form.setValue("sector", "");
    form.setValue("cin", "");
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      setIsGenerating(true);

      setSetupStep("Creating case…");
      const newCase = await createCase.mutateAsync({ data: values });

      // Determine the ticker to use for BSE/Screener fetches
      const ticker = selectedCompany?.ticker ?? "";

      // Run research first (fetches Screener financials + news) — gives memo real data
      try {
        setSetupStep("Fetching public data & research…");
        await runResearch.mutateAsync({ caseId: newCase.id });
      } catch {
        // Non-fatal — continue without research data
      }

      // Fire annual report fetch in background (takes ~2-5 min; don't block UX)
      if (ticker) {
        fetchAnnualReports.mutateAsync({
          caseId: newCase.id,
          symbol: ticker,
          companyName: values.borrowerName,
        }).catch(() => {});
      }

      setSetupStep("Generating AI draft…");
      await generateMemo.mutateAsync({ id: newCase.id });

      toast({
        title: "Case ready",
        description: ticker
          ? "AI memo drafted. Annual reports are being fetched in the background — refresh Data Room in a few minutes."
          : "AI memo drafted from available data.",
      });

      setLocation(`/cases/${newCase.id}`);
    } catch {
      toast({
        title: "Error",
        description: "Failed to create case or initialize generation.",
        variant: "destructive",
      });
      setIsGenerating(false);
      setSetupStep("");
    }
  }

  const history = selectedCompany?.financialHistory ?? [];

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link
          href="/cases"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 w-10"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          <span className="sr-only">Back</span>
        </Link>
        <div>
          <h1 className="text-3xl font-medium tracking-tight">New CAM Request</h1>
          <p className="text-muted-foreground mt-1">
            Provide initial parameters to generate the draft memo.
          </p>
        </div>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" />
            Lookup from Public Sources
            <Badge variant="outline" className="ml-2 text-[10px] py-0">NSE / BSE</Badge>
          </CardTitle>
          <CardDescription>
            Search for any publicly listed Indian company to auto-extract financial data from
            stock exchange disclosures.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div ref={searchRef} className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              {isSearching || isFetchingData ? (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={clearCompany}
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => suggestions.length > 0 && setIsSuggestionsOpen(true)}
                placeholder="Search company name or NSE/BSE ticker (e.g. Reliance, INFY.NS)..."
                className="pl-9 pr-9 bg-background"
              />
            </div>

            {isSuggestionsOpen && suggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.ticker}
                    type="button"
                    onClick={() => handleSelectCompany(s)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors border-b last:border-b-0"
                  >
                    <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.ticker}{" "}
                        {s.sector && (
                          <span className="ml-1 text-muted-foreground/70">· {s.sector}</span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] flex-shrink-0"
                    >
                      {s.exchange}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {isSuggestionsOpen && debouncedQuery.length >= 2 && suggestions.length === 0 && !isSearching && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-md px-4 py-3 text-sm text-muted-foreground">
                No listed companies found for &ldquo;{debouncedQuery}&rdquo;. Try with ticker like RELIANCE.NS or INFY.BO.
              </div>
            )}
          </div>

          {isFetchingData && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Fetching public financials from stock exchange data…
            </div>
          )}

          {selectedCompany && !isFetchingData && (
            <div className="mt-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{selectedCompany.name}</h3>
                    <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Data Loaded
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Database className="h-3 w-3" />
                    {selectedCompany.dataSource} · as of{" "}
                    {new Date(selectedCompany.fetchedAt).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                </div>
                {selectedCompany.currentPrice && (
                  <div className="text-right">
                    <div className="text-lg font-bold font-mono">
                      ₹{selectedCompany.currentPrice.toLocaleString("en-IN")}
                    </div>
                    <div className="text-xs text-muted-foreground">{selectedCompany.ticker}</div>
                  </div>
                )}
              </div>

              {selectedCompany.description && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {selectedCompany.description}
                </p>
              )}

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 p-3 bg-background/60 rounded-lg border">
                <MetricPill label="Market Cap" value={fmt(selectedCompany.marketCap)} />
                <MetricPill label="P/E Ratio" value={selectedCompany.peRatio} />
                <MetricPill label="P/B Ratio" value={selectedCompany.pbRatio} />
                <MetricPill label="D/E Ratio" value={selectedCompany.debtToEquity} />
                <MetricPill label="ROE" value={pct(selectedCompany.returnOnEquity)} />
                <MetricPill label="Net Margin" value={pct(selectedCompany.netProfitMargin)} />
              </div>

              {history.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Financial History (₹ Crores)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1.5 pr-4 font-medium text-muted-foreground">
                            FY
                          </th>
                          <th className="text-right py-1.5 px-3 font-medium text-muted-foreground">
                            Revenue
                          </th>
                          <th className="text-right py-1.5 px-3 font-medium text-muted-foreground">
                            EBITDA
                          </th>
                          <th className="text-right py-1.5 px-3 font-medium text-muted-foreground">
                            Net Profit
                          </th>
                          <th className="text-right py-1.5 pl-3 font-medium text-muted-foreground">
                            Total Assets
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((row) => (
                          <tr key={row.year} className="border-b last:border-b-0">
                            <td className="py-1.5 pr-4 font-medium">{row.year}</td>
                            <td className="text-right py-1.5 px-3 font-mono tabular-nums">
                              {row.revenue != null ? row.revenue.toLocaleString("en-IN") : "—"}
                            </td>
                            <td className="text-right py-1.5 px-3 font-mono tabular-nums">
                              {row.ebitda != null ? row.ebitda.toLocaleString("en-IN") : "—"}
                            </td>
                            <td
                              className={`text-right py-1.5 px-3 font-mono tabular-nums ${
                                row.netProfit != null && row.netProfit < 0
                                  ? "text-red-500"
                                  : "text-emerald-600"
                              }`}
                            >
                              {row.netProfit != null
                                ? row.netProfit.toLocaleString("en-IN")
                                : "—"}
                            </td>
                            <td className="text-right py-1.5 pl-3 font-mono tabular-nums">
                              {row.totalAssets != null
                                ? row.totalAssets.toLocaleString("en-IN")
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {selectedCompany.sector && (
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {selectedCompany.sector}
                  </span>
                )}
                {selectedCompany.industry && selectedCompany.industry !== selectedCompany.sector && (
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {selectedCompany.industry}
                  </span>
                )}
                {selectedCompany.employees && (
                  <span className="px-2 py-0.5 rounded bg-muted">
                    {selectedCompany.employees.toLocaleString("en-IN")} employees
                  </span>
                )}
                {selectedCompany.website && (
                  <a
                    href={selectedCompany.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 rounded bg-muted hover:bg-muted/70 text-primary underline-offset-2 hover:underline"
                  >
                    {selectedCompany.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-display tracking-tight">
                <Building2 className="h-5 w-5 text-primary" />
                Borrower Details
                {selectedCompany && (
                  <Badge
                    variant="outline"
                    className="ml-2 text-[10px] text-emerald-600 border-emerald-500/30"
                  >
                    Auto-filled
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Company identifiers and core information used to fetch external data.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="borrowerName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Entity / Borrower Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Reliance Industries Limited"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Corporate Identity Number (CIN)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. L25111MH1988PLC048925"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Optional. Helps AI fetch MCA data.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. ABCDE1234F"
                        className="uppercase"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sector"
                render={({ field }) => (
                  <FormItem className="col-span-2 md:col-span-1">
                    <FormLabel>Industry Sector</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Manufacturing, IT, Healthcare"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-display tracking-tight">
                <Briefcase className="h-5 w-5 text-primary" />
                Facility Request
              </CardTitle>
              <CardDescription>
                The credit facility parameters being proposed.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="facilityType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Facility Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select facility type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="term_loan">Term Loan</SelectItem>
                        <SelectItem value="working_capital">
                          Working Capital
                        </SelectItem>
                        <SelectItem value="letter_of_credit">
                          Letter of Credit
                        </SelectItem>
                        <SelectItem value="bank_guarantee">
                          Bank Guarantee
                        </SelectItem>
                        <SelectItem value="overdraft">Overdraft</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="facilityAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (INR)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl font-display tracking-tight">
                <UserCircle className="h-5 w-5 text-primary" />
                Internal Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="rmName"
                render={({ field }) => (
                  <FormItem className="max-w-md">
                    <FormLabel>Relationship Manager Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button variant="outline" type="button" asChild>
              <Link href="/cases">Cancel</Link>
            </Button>
            <Button
              type="submit"
              disabled={isGenerating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[220px]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {setupStep || "Working…"}
                </>
              ) : (
                <>
                  <FileSignature className="mr-2 h-4 w-4" />
                  Create & Generate Memo
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
