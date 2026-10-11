"""Group organogram: data model -> deterministic layout -> diagram.

Workflow (see annual_report.group_structure_from for step 1):
  1. Annual report Form AOC-1 -> group entities with holding % (auto)
  2. Promoter holding % from the shareholding pattern (auto)
  3. RM reviews / edits the entity list in the Data Room (verified flag)
  4. The CAM embeds a ```organogram JSON block; the web app renders it as SVG
     and the PDF export draws it with ReportLab — both from layout() below
     (the TypeScript renderer mirrors the same rules).

Layout: promoter group -> borrower -> one column per entity group
(Subsidiaries - India, Subsidiaries - Overseas, Joint ventures & associates),
entities stacked by size. Large groups overflow into a "+N more" box that
points to the entity table.
"""
import json
import re
from typing import Any, Dict, List, Optional

MAX_PER_COLUMN = 18

_OVERSEAS_MARKERS = re.compile(
    r"\b(GmbH|Inc\.?|LLC|AB|S\.?p\.?A\.?|B\.?V\.?|SL|SAS|S\.?A\.?|AG|Pte|Pty|PLC|Corp\.?|N\.?V\.?|"
    r"Kft|s\.r\.o|Oy|ApS|Sdn Bhd|Co\.,? Ltd)\b", re.I)


def region(entity: Dict[str, Any]) -> str:
    c = str(entity.get("country") or "").strip().lower()
    if c:
        return "india" if c in ("india", "in") else "overseas"
    cur = str(entity.get("currency") or "").strip().upper()
    if cur:  # AOC-1 reporting currency is the most reliable signal when country is blank
        return "india" if cur in ("INR", "RS", "₹") else "overseas"
    name = entity.get("name") or ""
    if re.search(r"Private Limited|Pvt\.? Ltd", name, re.I):
        return "india"
    return "overseas" if _OVERSEAS_MARKERS.search(name) else "india"


COLUMNS = [
    ("sub_india", "Subsidiaries — India"),
    ("sub_overseas", "Subsidiaries — Overseas"),
    ("jv_assoc", "Joint ventures & associates"),
]


def column_of(entity: Dict[str, Any]) -> str:
    rel = str(entity.get("relation") or "subsidiary").lower()
    if "joint" in rel or "assoc" in rel:
        return "jv_assoc"
    return "sub_india" if region(entity) == "india" else "sub_overseas"


def _pct(v) -> str:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    return f"{f:.0f}%" if abs(f - round(f)) < 0.05 else f"{f:.2f}%"


def compact(gs: Dict[str, Any]) -> Dict[str, Any]:
    """The minimal JSON embedded in the CAM (what both renderers consume)."""
    cols: Dict[str, List[Dict[str, Any]]] = {k: [] for k, _ in COLUMNS}
    for e in gs.get("entities") or []:
        if not e.get("name"):
            continue
        cols[column_of(e)].append({
            "n": re.sub(r"\s*\((formerly|earlier)[^)]*\)", "", e["name"], flags=re.I).strip(),
            "p": _pct(e.get("holding_pct")),
            "t": e.get("turnover_cr") if isinstance(e.get("turnover_cr"), (int, float)) else None,
        })
    for k in cols:
        cols[k].sort(key=lambda x: (-(x["t"] or 0), x["n"]))
    return {
        "borrower": gs.get("borrower") or "Borrower",
        "promoter": gs.get("promoter_group") or "Promoter group",
        "promoter_pct": _pct(gs.get("promoter_holding_pct")),
        "verified": bool(gs.get("verified")),
        "columns": [{"key": k, "title": t, "items": cols[k]} for k, t in COLUMNS if cols[k]],
    }


def md_block(gs: Dict[str, Any]) -> str:
    return "```organogram\n" + json.dumps(compact(gs), ensure_ascii=False) + "\n```"


def parse_block(text: str) -> Optional[Dict[str, Any]]:
    m = re.search(r"```organogram\s*\n(.*?)\n```", text or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def _wrap(text: str, max_chars: int, max_lines: int = 2) -> List[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= max_chars:
            cur = f"{cur} {w}".strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][: max(0, max_chars - 1)].rstrip() + "…"
    return lines


def layout(data: Dict[str, Any], width: float = 515.0) -> Dict[str, Any]:
    """Boxes and connector lines in a top-left coordinate system (y grows down)."""
    boxes, lines = [], []
    cx = width / 2
    y = 0.0
    top_w, top_h = 230.0, 34.0
    boxes.append({"x": cx - top_w / 2, "y": y, "w": top_w, "h": top_h, "kind": "promoter",
                  "lines": _wrap(data.get("promoter") or "Promoter group", 40), "sub": "Promoter group"})
    y += top_h
    edge_top = y
    y += 26
    lines.append({"x1": cx, "y1": edge_top, "x2": cx, "y2": y, "label": data.get("promoter_pct") or ""})
    b_w, b_h = 250.0, 38.0
    boxes.append({"x": cx - b_w / 2, "y": y, "w": b_w, "h": b_h, "kind": "borrower",
                  "lines": _wrap(data.get("borrower") or "Borrower", 44), "sub": "Borrower"})
    y += b_h
    cols = data.get("columns") or []
    if not cols:
        return {"width": width, "height": y + 4, "boxes": boxes, "lines": lines}
    bus_y = y + 18
    lines.append({"x1": cx, "y1": y, "x2": cx, "y2": bus_y, "label": ""})
    gap = 10.0
    col_w = (width - gap * (len(cols) - 1)) / len(cols)
    centers = [col_w / 2 + i * (col_w + gap) for i in range(len(cols))]
    if len(cols) > 1:
        lines.append({"x1": centers[0], "y1": bus_y, "x2": centers[-1], "y2": bus_y, "label": ""})
    head_y = bus_y + 14
    max_bottom = head_y
    chars = max(14, int(col_w / 4.1))
    for i, col in enumerate(cols):
        x0 = i * (col_w + gap)
        lines.append({"x1": centers[i], "y1": bus_y, "x2": centers[i], "y2": head_y, "label": ""})
        boxes.append({"x": x0, "y": head_y, "w": col_w, "h": 22, "kind": "header",
                      "lines": [f"{col['title']} ({len(col['items'])})"], "sub": ""})
        yy = head_y + 22 + 6
        items = col["items"]
        shown = items[:MAX_PER_COLUMN] if len(items) <= MAX_PER_COLUMN else items[:MAX_PER_COLUMN - 1]
        for it in shown:
            label = it["n"] + (f"  {it['p']}" if it.get("p") else "")
            wl = _wrap(label, chars)
            h = 12 + 8 * len(wl)
            boxes.append({"x": x0 + 6, "y": yy, "w": col_w - 12, "h": h, "kind": "entity", "lines": wl, "sub": ""})
            lines.append({"x1": x0 + 3, "y1": yy + h / 2, "x2": x0 + 6, "y2": yy + h / 2, "label": ""})
            yy += h + 4
        if len(items) > len(shown):
            boxes.append({"x": x0 + 6, "y": yy, "w": col_w - 12, "h": 18, "kind": "more",
                          "lines": [f"+{len(items) - len(shown)} more — see entity table"], "sub": ""})
            yy += 22
        lines.append({"x1": x0 + 3, "y1": head_y + 22, "x2": x0 + 3, "y2": yy - 4 - 7, "label": ""})
        max_bottom = max(max_bottom, yy)
    return {"width": width, "height": max_bottom + 4, "boxes": boxes, "lines": lines}


def to_reportlab(data: Dict[str, Any], width: float = 515.0):
    """A ReportLab Drawing of the layout (PDF export)."""
    from reportlab.graphics.shapes import Drawing, Line, Rect, String
    from reportlab.lib import colors

    lay = layout(data, width)
    h = lay["height"]
    d = Drawing(width, h)
    navy, gold = colors.HexColor("#0D1B2A"), colors.HexColor("#C9A84C")
    grey, light = colors.HexColor("#8A94A3"), colors.HexColor("#EEF1F5")

    def Y(y):  # top-left -> ReportLab bottom-left
        return h - y

    for ln in lay["lines"]:
        d.add(Line(ln["x1"], Y(ln["y1"]), ln["x2"], Y(ln["y2"]), strokeColor=grey, strokeWidth=0.8))
        if ln.get("label"):
            d.add(String(ln["x1"] + 5, Y((ln["y1"] + ln["y2"]) / 2) - 3, ln["label"],
                         fontName="Helvetica-Bold", fontSize=7.5, fillColor=navy))
    for b in lay["boxes"]:
        kind = b["kind"]
        fill = {"promoter": light, "borrower": navy, "header": colors.HexColor("#DDE3EA"),
                "entity": colors.white, "more": colors.white}[kind]
        stroke = gold if kind == "borrower" else grey
        d.add(Rect(b["x"], Y(b["y"] + b["h"]), b["w"], b["h"], rx=3, ry=3,
                   fillColor=fill, strokeColor=stroke, strokeWidth=0.8 if kind != "borrower" else 1.4))
        txt_color = colors.white if kind == "borrower" else navy
        size = {"promoter": 8, "borrower": 9, "header": 7.5, "entity": 6.4, "more": 6.4}[kind]
        font = "Helvetica-Bold" if kind in ("promoter", "borrower", "header") else "Helvetica"
        n = len(b["lines"]) + (1 if b["sub"] else 0)
        line_h = size + 1.5
        start = b["y"] + (b["h"] - n * line_h) / 2 + size
        if b["sub"]:
            d.add(String(b["x"] + b["w"] / 2, Y(start), b["sub"].upper(), textAnchor="middle",
                         fontName="Helvetica", fontSize=5.8,
                         fillColor=gold if kind == "borrower" else grey))
            start += line_h
        for i, t in enumerate(b["lines"]):
            anchor_x = b["x"] + (b["w"] / 2 if kind != "entity" else 5)
            d.add(String(anchor_x, Y(start + i * line_h), t, textAnchor="middle" if kind != "entity" else "start",
                         fontName=font, fontSize=size, fillColor=txt_color))
    return d
