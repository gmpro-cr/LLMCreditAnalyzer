// Group organogram renderer. Mirrors python-service/organogram.py layout() so the
// diagram in the app matches the one in the exported PDF.

export interface OrganogramItem { n: string; p?: string; t?: number | null }
export interface OrganogramData {
  borrower: string;
  promoter: string;
  promoter_pct?: string;
  verified?: boolean;
  columns: { key: string; title: string; items: OrganogramItem[] }[];
}

type Box = { x: number; y: number; w: number; h: number; kind: "promoter" | "borrower" | "header" | "entity" | "more"; lines: string[]; sub: string };
type Line = { x1: number; y1: number; x2: number; y2: number; label: string };

const MAX_PER_COLUMN = 18;

function wrap(text: string, maxChars: number, maxLines = 2): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur.length + w.length + (cur ? 1 : 0) <= maxChars) cur = cur ? `${cur} ${w}` : w;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
    return kept;
  }
  return lines;
}

export function layoutOrganogram(data: OrganogramData, width = 760) {
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const cx = width / 2;
  let y = 0;
  const topW = 300, topH = 40;
  boxes.push({ x: cx - topW / 2, y, w: topW, h: topH, kind: "promoter", lines: wrap(data.promoter || "Promoter group", 48), sub: "Promoter group" });
  y += topH;
  const edgeTop = y;
  y += 30;
  lines.push({ x1: cx, y1: edgeTop, x2: cx, y2: y, label: data.promoter_pct || "" });
  const bW = 320, bH = 44;
  boxes.push({ x: cx - bW / 2, y, w: bW, h: bH, kind: "borrower", lines: wrap(data.borrower || "Borrower", 50), sub: "Borrower" });
  y += bH;
  const cols = data.columns || [];
  if (!cols.length) return { width, height: y + 4, boxes, lines };
  const busY = y + 20;
  lines.push({ x1: cx, y1: y, x2: cx, y2: busY, label: "" });
  const gap = 14;
  const colW = (width - gap * (cols.length - 1)) / cols.length;
  const centers = cols.map((_, i) => colW / 2 + i * (colW + gap));
  if (cols.length > 1) lines.push({ x1: centers[0], y1: busY, x2: centers[centers.length - 1], y2: busY, label: "" });
  const headY = busY + 16;
  let maxBottom = headY;
  const chars = Math.max(16, Math.floor(colW / 6.2));
  cols.forEach((col, i) => {
    const x0 = i * (colW + gap);
    lines.push({ x1: centers[i], y1: busY, x2: centers[i], y2: headY, label: "" });
    boxes.push({ x: x0, y: headY, w: colW, h: 26, kind: "header", lines: [`${col.title} (${col.items.length})`], sub: "" });
    let yy = headY + 26 + 8;
    const items = col.items;
    const shown = items.length <= MAX_PER_COLUMN ? items : items.slice(0, MAX_PER_COLUMN - 1);
    for (const it of shown) {
      const wl = wrap(it.n + (it.p ? `  ${it.p}` : ""), chars);
      const h = 14 + 12 * wl.length;
      boxes.push({ x: x0 + 8, y: yy, w: colW - 16, h, kind: "entity", lines: wl, sub: "" });
      lines.push({ x1: x0 + 4, y1: yy + h / 2, x2: x0 + 8, y2: yy + h / 2, label: "" });
      yy += h + 5;
    }
    if (items.length > shown.length) {
      boxes.push({ x: x0 + 8, y: yy, w: colW - 16, h: 22, kind: "more", lines: [`+${items.length - shown.length} more — see entity table`], sub: "" });
      yy += 27;
    }
    lines.push({ x1: x0 + 4, y1: headY + 26, x2: x0 + 4, y2: yy - 5 - 9, label: "" });
    maxBottom = Math.max(maxBottom, yy);
  });
  return { width, height: maxBottom + 4, boxes, lines };
}

const FILL: Record<Box["kind"], string> = {
  promoter: "hsl(var(--muted))", borrower: "hsl(var(--primary))", header: "hsl(var(--accent))",
  entity: "hsl(var(--background))", more: "hsl(var(--background))",
};

export function Organogram({ data }: { data: OrganogramData }) {
  const lay = layoutOrganogram(data);
  return (
    <figure className="not-prose my-4 overflow-x-auto rounded border border-border bg-card p-3 font-sans">
      <svg viewBox={`-2 -2 ${lay.width + 4} ${lay.height + 4}`} className="w-full min-w-[560px]" role="img"
        aria-label={`Group structure of ${data.borrower}`}>
        {lay.lines.map((l, i) => (
          <g key={`l${i}`}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.55} strokeWidth={1} />
            {l.label && (
              <text x={l.x1 + 7} y={(l.y1 + l.y2) / 2 + 4} fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">{l.label}</text>
            )}
          </g>
        ))}
        {lay.boxes.map((b, i) => {
          const isBorrower = b.kind === "borrower";
          const size = { promoter: 12, borrower: 13, header: 11, entity: 10, more: 10 }[b.kind];
          const lh = size + 2;
          const n = b.lines.length + (b.sub ? 1 : 0);
          let start = b.y + (b.h - n * lh) / 2 + size - 1;
          const anchor = b.kind === "entity" ? "start" : "middle";
          const tx = b.kind === "entity" ? b.x + 7 : b.x + b.w / 2;
          return (
            <g key={`b${i}`}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={FILL[b.kind]}
                stroke={isBorrower ? "hsl(var(--primary))" : "hsl(var(--border))"} strokeWidth={isBorrower ? 1.5 : 1} />
              {b.sub && (
                <text x={tx} y={start} textAnchor={anchor} fontSize={8.5} letterSpacing={0.6}
                  fill={isBorrower ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))"} opacity={0.85}>
                  {b.sub.toUpperCase()}
                </text>
              )}
              {b.lines.map((t, j) => (
                <text key={j} x={tx} y={start + (b.sub ? lh : 0) + j * lh} textAnchor={anchor} fontSize={size}
                  fontWeight={b.kind === "entity" || b.kind === "more" ? 400 : 600}
                  fill={isBorrower ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"}>{t}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Build the diagram data from an editable group structure (same rules as the engine). */
export function compactGroupStructure(gs: {
  borrower?: string; promoter_group?: string | null; promoter_holding_pct?: number | null; verified?: boolean;
  entities: { name: string; relation: string; country?: string | null; currency?: string | null; holding_pct?: number | null; turnover_cr?: number | null }[];
}): OrganogramData {
  const pct = (v?: number | null) => (typeof v === "number" && !isNaN(v) ? (Math.abs(v - Math.round(v)) < 0.05 ? `${v.toFixed(0)}%` : `${v.toFixed(2)}%`) : "");
  const overseas = /\b(GmbH|Inc\.?|LLC|AB|S\.?p\.?A\.?|B\.?V\.?|SL|SAS|S\.?A\.?|AG|Pte|Pty|PLC|Corp\.?|N\.?V\.?|Kft|Oy|ApS)\b/i;
  const region = (e: { name: string; country?: string | null; currency?: string | null }) => {
    const c = (e.country || "").trim().toLowerCase();
    if (c) return c === "india" || c === "in" ? "india" : "overseas";
    const cur = (e.currency || "").trim().toUpperCase();
    if (cur) return cur === "INR" ? "india" : "overseas";
    if (/Private Limited|Pvt\.? Ltd/i.test(e.name)) return "india";
    return overseas.test(e.name) ? "overseas" : "india";
  };
  const cols: Record<string, OrganogramItem[]> = { sub_india: [], sub_overseas: [], jv_assoc: [] };
  for (const e of gs.entities || []) {
    if (!e.name?.trim()) continue;
    const rel = (e.relation || "subsidiary").toLowerCase();
    const key = /joint|assoc/.test(rel) ? "jv_assoc" : region(e) === "india" ? "sub_india" : "sub_overseas";
    cols[key].push({ n: e.name.replace(/\s*\((formerly|earlier)[^)]*\)/i, "").trim(), p: pct(e.holding_pct), t: e.turnover_cr ?? null });
  }
  for (const k of Object.keys(cols)) cols[k].sort((a, b) => (b.t ?? 0) - (a.t ?? 0) || a.n.localeCompare(b.n));
  const titles: [string, string][] = [["sub_india", "Subsidiaries — India"], ["sub_overseas", "Subsidiaries — Overseas"], ["jv_assoc", "Joint ventures & associates"]];
  return {
    borrower: gs.borrower || "Borrower",
    promoter: gs.promoter_group || "Promoter group",
    promoter_pct: pct(gs.promoter_holding_pct),
    verified: !!gs.verified,
    columns: titles.filter(([k]) => cols[k].length).map(([key, title]) => ({ key, title, items: cols[key] })),
  };
}
