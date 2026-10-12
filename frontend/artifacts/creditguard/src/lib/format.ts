const CR = 1e7;

/** ₹ amount stored in rupees → "₹250.00 Cr" (Indian grouping for large values). */
export function formatCr(rupees: number | null | undefined, decimals = 2): string {
  if (rupees === null || rupees === undefined || isNaN(Number(rupees))) return "—";
  const cr = Number(rupees) / CR;
  return `₹${cr.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} Cr`;
}

/** A value already in ₹ crore → "₹16,812 Cr" (whole crore from 100). */
export function formatCrValue(cr: number | null | undefined): string {
  if (cr === null || cr === undefined || isNaN(Number(cr))) return "—";
  const n = Number(cr);
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 })} Cr`;
}

/** Kept for callers that show full rupee amounts. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

/** "12 Oct 2026" — Indian banking convention, never ISO. */
export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("en-IN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(dateString));
}

/** "12 Oct 2026, 09:12" */
export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(dateString));
}

export function caseRef(id: number, createdAt?: string): string {
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  return `CAM-${year}-${String(id).padStart(4, "0")}`;
}

export function facilityLabel(type: string): string {
  const t = (type || "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
