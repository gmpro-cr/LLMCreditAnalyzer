import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PiCalculatorLight, PiWarningLight, PiCheckCircleLight } from "react-icons/pi";

interface DPRow {
  label: string;
  key: string;
  isSubtotal?: boolean;
  isTotal?: boolean;
  isResult?: boolean;
  margin?: number; // bank financing % applied to this row
  indent?: boolean;
  computed?: boolean; // computed from other rows
}

const DP_ROWS: DPRow[] = [
  { label: "Stock / Inventory (at cost)",                key: "inventory",       indent: true },
  { label: "Book Debts / Trade Receivables (< 90 days)", key: "debtors",         indent: true },
  { label: "Advance to Suppliers",                       key: "advances",        indent: true },
  { label: "Other Current Assets",                       key: "other_ca",        indent: true },
  { label: "Total Current Assets (A)",                   key: "total_ca",        isSubtotal: true, computed: true },
  { label: "Less: Trade Creditors / Payables",           key: "creditors",       indent: true },
  { label: "Less: Advance from Customers",               key: "adv_customers",   indent: true },
  { label: "Less: Other Current Liabilities (excl. bank borrowings)", key: "other_cl", indent: true },
  { label: "Total CL excl. Bank Borrowings (B)",         key: "total_cl",        isSubtotal: true, computed: true },
  { label: "Working Capital Gap — WCG (A − B)",          key: "wcg",             isTotal: true, computed: true },
  { label: "Bank Financing @ 75% of WCG (Method II)",    key: "bank_fin",        isTotal: true, computed: true },
  { label: "Sanctioned Limit",                           key: "limit" },
  { label: "Drawing Power (min of Bank Fin & Limit)",    key: "dp",              isResult: true, computed: true },
];

interface Props {
  proposedLimit: number; // ₹ Cr from case data
  balanceSheetData?: {
    inventory?: number;
    debtors?: number;
    other_ca?: number;
    creditors?: number;
  };
  onDPChange?: (dp: number, table: Record<string, number>) => void;
}

export default function DrawingPowerPiCalculatorLight({ proposedLimit, balanceSheetData, onDPChange }: Props) {
  const [values, setValues] = useState<Record<string, string>>({
    inventory:     balanceSheetData?.inventory     ? String(balanceSheetData.inventory)     : "",
    debtors:       balanceSheetData?.debtors       ? String(balanceSheetData.debtors)       : "",
    advances:      "",
    other_ca:      balanceSheetData?.other_ca      ? String(balanceSheetData.other_ca)      : "",
    creditors:     balanceSheetData?.creditors     ? String(balanceSheetData.creditors)     : "",
    adv_customers: "",
    other_cl:      "",
    limit:         String(proposedLimit),
  });

  const n = (key: string) => parseFloat(values[key] || "0") || 0;

  const total_ca    = n("inventory") + n("debtors") + n("advances") + n("other_ca");
  const total_cl    = n("creditors") + n("adv_customers") + n("other_cl");
  const wcg         = total_ca - total_cl;
  const bank_fin    = Math.round(wcg * 0.75 * 100) / 100;
  const limit       = n("limit");
  const dp          = Math.min(bank_fin, limit);

  const computed: Record<string, number> = { total_ca, total_cl, wcg, bank_fin, limit, dp };

  useEffect(() => {
    onDPChange?.(dp, { ...computed });
  }, [dp]);

  const utilisationPct = limit > 0 ? Math.round((dp / limit) * 100) : 0;
  const dpStatus: "ok" | "warn" | "short" =
    dp >= limit * 0.8 ? "ok" : dp >= limit * 0.5 ? "warn" : "short";

  const statusConfig = {
    ok:    { color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", icon: <PiCheckCircleLight className="h-4 w-4 text-emerald-500" />, label: "Adequate" },
    warn:  { color: "text-amber-600",   bg: "bg-amber-50 border-amber-200",     icon: <PiWarningLight className="h-4 w-4 text-amber-500" />,   label: "Borderline" },
    short: { color: "text-red-600",     bg: "bg-red-50 border-red-200",         icon: <PiWarningLight className="h-4 w-4 text-red-500" />,     label: "Insufficient" },
  };

  const fmtCr = (v: number) => v === 0 ? "—" : `₹ ${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;

  return (
    <Card className="border-blue-200 bg-blue-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <PiCalculatorLight className="h-4 w-4 text-blue-500" />
            Drawing Power PiCalculatorLight
            <Badge variant="outline" className="text-[10px] font-normal">Tandon Method II</Badge>
          </CardTitle>
          {dp > 0 && (
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded border ${statusConfig[dpStatus].bg} ${statusConfig[dpStatus].color}`}>
              {statusConfig[dpStatus].icon}
              DP: {fmtCr(dp)} ({utilisationPct}% of limit) — {statusConfig[dpStatus].label}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Enter figures from latest stock statement / balance sheet. All amounts in ₹ Crore.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-semibold text-muted-foreground w-2/3">Line Item</th>
                <th className="text-right py-2 font-semibold text-muted-foreground w-1/3">Amount (₹ Cr)</th>
              </tr>
            </thead>
            <tbody>
              {DP_ROWS.map((row) => {
                const isComputed = row.computed;
                const val = isComputed ? computed[row.key] : undefined;

                const rowCls = row.isResult
                  ? "bg-blue-600/10 font-bold text-blue-700 border-t-2 border-blue-300"
                  : row.isTotal
                  ? "bg-muted/60 font-semibold border-t border-border"
                  : row.isSubtotal
                  ? "font-medium bg-muted/30"
                  : "";

                return (
                  <tr key={row.key} className={`border-b border-border/50 ${rowCls}`}>
                    <td className={`py-2 pr-4 ${row.indent ? "pl-4 text-muted-foreground" : "font-medium"}`}>
                      {row.label}
                      {row.key === "bank_fin" && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(RBI Tandon norms)</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {isComputed ? (
                        <span className={val === 0 ? "text-muted-foreground" : row.isResult ? "text-blue-700 font-bold" : ""}>
                          {fmtCr(val ?? 0)}
                        </span>
                      ) : (
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={values[row.key] ?? ""}
                          onChange={(e) => setValues((prev) => ({ ...prev, [row.key]: e.target.value }))}
                          className={`h-7 text-xs text-right w-32 ml-auto ${
                            row.key === "limit" ? "border-blue-300 bg-blue-50/50" : ""
                          }`}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {wcg <= 0 && total_ca > 0 && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <PiWarningLight className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            Working Capital Gap is zero or negative — current liabilities exceed current assets.
            Verify figures against stock statement; drawing power may not be supportable.
          </div>
        )}

        <div className="mt-3 text-[10px] text-muted-foreground border-t pt-2">
          <strong>Note:</strong> Drawing Power is computed as minimum of (75% of WCG per Method II) and sanctioned limit.
          Update values from stock statement not older than 30 days for each drawdown.
          Debtors older than 90 days are ineligible for DP computation.
        </div>
      </CardContent>
    </Card>
  );
}
