import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetRmInputs, useSaveRmInputs, getRmInputsQueryKey, getDataRoomQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PiPlusLight, PiSpinnerLight, PiTrashLight, PiClipboardTextLight } from "react-icons/pi";

type Row = Record<string, string>;
type Inputs = {
  proposal?: Record<string, string>;
  security?: Record<string, string>;
  banking?: Row[];
  customers?: Row[];
  suppliers?: Row[];
  conduct?: Record<string, string>;
  references?: Row[];
  working_capital?: Record<string, string>;
  notes?: string;
};

type Field = { key: string; label: string; placeholder?: string; type?: "text" | "number" | "textarea" | "select"; options?: string[] };

const PROPOSAL: Field[] = [
  { key: "proposal_type", label: "Proposal type", type: "select", options: ["", "Fresh", "Renewal", "Enhancement", "Renewal cum enhancement", "Takeover"] },
  { key: "purpose", label: "Purpose / end-use", type: "textarea", placeholder: "e.g. Part-finance capex for the new ring mill at Baramati (project cost ₹…)" },
  { key: "tenor_months", label: "Tenor (months)", type: "number" },
  { key: "moratorium_months", label: "Moratorium (months)", type: "number" },
  { key: "repayment", label: "Repayment", placeholder: "e.g. 16 equal quarterly instalments after moratorium" },
  { key: "pricing", label: "Pricing", placeholder: "e.g. 3M T-Bill + 1.10% p.a.; processing fee 0.25%" },
  { key: "rate_pct", label: "All-in rate % (for projections)", type: "number" },
  { key: "existing_exposure_cr", label: "Our existing exposure (₹ Cr)", type: "number" },
];
const SECURITY: Field[] = [
  { key: "primary", label: "Primary security", type: "textarea", placeholder: "e.g. Exclusive charge on assets financed" },
  { key: "collateral", label: "Collateral security", type: "textarea", placeholder: "e.g. Equitable mortgage of land & building at …" },
  { key: "collateral_value_cr", label: "Collateral value (₹ Cr)", type: "number" },
  { key: "valuation_date", label: "Valuation date", placeholder: "DD-MM-YYYY" },
  { key: "guarantees", label: "Guarantees", type: "textarea", placeholder: "Personal / corporate guarantees with guarantor net worth" },
];
const CONDUCT: Field[] = [
  { key: "cibil_cmr", label: "CIBIL / CMR", placeholder: "e.g. CMR-3; no overdues (report dated …)" },
  { key: "crilc", label: "CRILC / SMA status", placeholder: "e.g. No SMA reporting in last 12 months" },
  { key: "account_conduct", label: "Account conduct with lenders", type: "textarea" },
  { key: "defaulter_checks", label: "RBI / CIBIL defaulter checks (company & directors)" },
  { key: "litigation", label: "Litigation by lenders / material litigation" },
  { key: "roc_charges", label: "ROC charge search" },
  { key: "aml", label: "AML / sanctions screening" },
  { key: "gst", label: "GST filing regularity" },
  { key: "pledge", label: "Promoter pledge" },
  { key: "pep", label: "PEP status of promoters / directors" },
  { key: "common_directorship", label: "Common directorship check" },
  { key: "related_to_bank", label: "Directors related to the bank's directors / senior mgmt" },
  { key: "site_visit", label: "Site / plant visit", type: "textarea" },
  { key: "stock_audit", label: "Stock audit (WC facilities)" },
];
const WC: Field[] = [
  { key: "stock_statement_date", label: "Latest stock statement date" },
  { key: "inventory_cr", label: "Inventory (₹ Cr)", type: "number" },
  { key: "receivables_cr", label: "Receivables < 90 days (₹ Cr)", type: "number" },
  { key: "receivables_over_90_cr", label: "Receivables > 90 days (₹ Cr)", type: "number" },
  { key: "creditors_cr", label: "Trade creditors (₹ Cr)", type: "number" },
];

const TABLES: { key: keyof Inputs; title: string; cols: Field[] }[] = [
  { key: "banking", title: "Existing banking arrangement (lender-wise)", cols: [
    { key: "bank", label: "Lender" }, { key: "facility", label: "Facility" },
    { key: "sanctioned_cr", label: "Sanctioned ₹ Cr", type: "number" }, { key: "outstanding_cr", label: "Outstanding ₹ Cr", type: "number" },
    { key: "security", label: "Security" }, { key: "remarks", label: "Remarks" }] },
  { key: "customers", title: "Top customers", cols: [
    { key: "name", label: "Customer" }, { key: "share_pct", label: "% of sales", type: "number" },
    { key: "years", label: "Relationship (yrs)" }, { key: "remarks", label: "Remarks" }] },
  { key: "suppliers", title: "Top suppliers", cols: [
    { key: "name", label: "Supplier" }, { key: "share_pct", label: "% of purchases", type: "number" },
    { key: "years", label: "Relationship (yrs)" }, { key: "remarks", label: "Remarks" }] },
  { key: "references", title: "Reference checks", cols: [
    { key: "party", label: "Counterparty" }, { key: "relationship", label: "Relationship" },
    { key: "contact", label: "Contact person" }, { key: "date", label: "Date" }, { key: "feedback", label: "Feedback" }] },
];

function FieldInput({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  if (f.type === "textarea") return <Textarea className="min-h-[64px] text-sm" value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === "select") {
    return (
      <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {(f.options ?? []).map((o) => <option key={o} value={o}>{o || "Select…"}</option>)}
      </select>
    );
  }
  return <Input className="text-sm" type={f.type === "number" ? "number" : "text"} step="any" value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b pb-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h4>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Information only the RM has. Everything the CAM marks "[RM to provide]" maps to
 * a field here; saving and regenerating replaces the placeholders and shrinks the
 * "Information Required from RM" list.
 */
export default function RmInputsPanel({ caseId, isWc }: { caseId: number; isWc: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetRmInputs(caseId);
  const save = useSaveRmInputs();
  const [inp, setInp] = useState<Inputs>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (data && !dirty) setInp((data.inputs as Inputs) || {}); }, [data, dirty]);

  const setObj = (group: "proposal" | "security" | "conduct" | "working_capital", key: string, v: string) => {
    setInp((p) => ({ ...p, [group]: { ...(p[group] || {}), [key]: v } }));
    setDirty(true);
  };
  const setRows = (key: keyof Inputs, rows: Row[]) => { setInp((p) => ({ ...p, [key]: rows })); setDirty(true); };

  const handleSave = async () => {
    // Drop empty strings / rows so the engine sees absent data as absent.
    const clean = (o?: Record<string, string>) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => String(v ?? "").trim() !== ""));
    const cleanRows = (rows?: Row[]) => (rows || []).map((r) => clean(r)).filter((r) => Object.keys(r).length > 0);
    const payload: Inputs = {
      proposal: clean(inp.proposal), security: clean(inp.security), conduct: clean(inp.conduct),
      working_capital: clean(inp.working_capital),
      banking: cleanRows(inp.banking), customers: cleanRows(inp.customers), suppliers: cleanRows(inp.suppliers),
      references: cleanRows(inp.references), notes: inp.notes?.trim() || undefined,
    };
    try {
      await save.mutateAsync({ caseId, inputs: payload as Record<string, unknown> });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: getRmInputsQueryKey(caseId) });
      queryClient.invalidateQueries({ queryKey: getDataRoomQueryKey(caseId) });
      toast({ title: "RM inputs saved", description: "Regenerate the CAM to apply them." });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2"><PiClipboardTextLight className="h-5 w-5 text-primary" /> RM inputs</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Details that are not public. Each field replaces a “[RM to provide]” placeholder in the CAM — see the
            “Information Required from RM” section for what is still missing. Leave a field blank if not yet known.
          </p>
        </div>
        <Button onClick={handleSave} disabled={save.isPending || !dirty}>
          {save.isPending && <PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" />}{dirty ? "Save inputs" : "Saved"}
        </Button>
      </div>

      <Group title="Proposal & facility terms">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROPOSAL.map((f) => (
            <div key={f.key} className={f.type === "textarea" ? "md:col-span-2" : ""}>
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <FieldInput f={f} value={inp.proposal?.[f.key] ?? ""} onChange={(v) => setObj("proposal", f.key, v)} />
            </div>
          ))}
        </div>
      </Group>

      <Group title="Security">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SECURITY.map((f) => (
            <div key={f.key} className={f.type === "textarea" ? "md:col-span-2" : ""}>
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <FieldInput f={f} value={inp.security?.[f.key] ?? ""} onChange={(v) => setObj("security", f.key, v)} />
            </div>
          ))}
        </div>
      </Group>

      {TABLES.map((t) => {
        const rows = (inp[t.key] as Row[] | undefined) ?? [];
        return (
          <Group key={t.key} title={t.title}>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground bg-muted/30">
                    {t.cols.map((c) => <th key={c.key} className="text-left font-normal px-2 py-1.5">{c.label}</th>)}
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {t.cols.map((c) => (
                        <td key={c.key} className="px-1.5 py-1">
                          <Input className="h-8 text-sm min-w-[90px]" type={c.type === "number" ? "number" : "text"} step="any" value={r[c.key] ?? ""}
                            onChange={(e) => setRows(t.key, rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)))} />
                        </td>
                      ))}
                      <td className="px-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Remove row"
                          onClick={() => setRows(t.key, rows.filter((_, j) => j !== i))}><PiTrashLight className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t px-2 py-1.5">
                <Button size="sm" variant="ghost" onClick={() => setRows(t.key, [...rows, {}])}><PiPlusLight className="mr-1.5 h-4 w-4" /> Add row</Button>
              </div>
            </div>
          </Group>
        );
      })}

      <Group title="Due diligence & conduct" hint="Record the outcome and the date / source of each check.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CONDUCT.filter((f) => f.key !== "stock_audit" || isWc).map((f) => (
            <div key={f.key} className={f.type === "textarea" ? "md:col-span-2" : ""}>
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <FieldInput f={f} value={inp.conduct?.[f.key] ?? ""} onChange={(v) => setObj("conduct", f.key, v)} />
            </div>
          ))}
        </div>
      </Group>

      {isWc && (
        <Group title="Working capital (latest stock statement)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {WC.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-muted-foreground">{f.label}</label>
                <FieldInput f={f} value={inp.working_capital?.[f.key] ?? ""} onChange={(v) => setObj("working_capital", f.key, v)} />
              </div>
            ))}
          </div>
        </Group>
      )}

      <Group title="Notes" hint="Management meeting, site visit or other observations the CAM should reflect.">
        <Textarea className="min-h-[90px] text-sm" value={inp.notes ?? ""} onChange={(e) => { setInp((p) => ({ ...p, notes: e.target.value })); setDirty(true); }} />
      </Group>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={save.isPending || !dirty}>
          {save.isPending && <PiSpinnerLight className="mr-2 h-4 w-4 animate-spin" />}{dirty ? "Save inputs" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
