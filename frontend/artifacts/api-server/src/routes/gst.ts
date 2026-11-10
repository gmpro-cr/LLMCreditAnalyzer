import { Router } from "express";
import multer from "multer";
import { PYTHON_URL, internalHeaders } from "../lib/python.js";

// GST returns analysis. Files are held in memory only and forwarded to the
// engine; nothing is written to disk, Storage or the database.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 2 } });

function asBlob(f: Express.Multer.File): Blob {
  return new Blob([new Uint8Array(f.buffer)], { type: f.mimetype });
}

async function relayError(pyRes: Response, fallback: string) {
  const body = await pyRes.text().catch(() => "");
  const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
  return { status: pyRes.status === 400 || pyRes.status === 413 ? pyRes.status : 502, message: parsed?.detail || fallback };
}

router.post(
  "/analyze",
  upload.fields([{ name: "file", maxCount: 1 }, { name: "bankFile", maxCount: 1 }]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const gst = files?.file?.[0];
    if (!gst) return res.status(400).json({ error: "No GST summary uploaded" });
    const bank = files?.bankFile?.[0];

    const form = new FormData();
    form.append("file", asBlob(gst), gst.originalname);
    if (bank) form.append("bank_file", asBlob(bank), bank.originalname);
    for (const [from, to] of [["legalName", "legal_name"], ["gstin", "gstin"], ["financialsTurnover", "financials_turnover"]] as const) {
      const v = (req.body?.[from] ?? "").toString().trim();
      if (v) form.append(to, v);
    }

    try {
      const pyRes = await fetch(`${PYTHON_URL()}/analyze-gst`, {
        method: "POST",
        headers: internalHeaders(),
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      if (!pyRes.ok) {
        const { status, message } = await relayError(pyRes, "Analysis failed");
        return res.status(status).json({ error: message });
      }
      return res.json(await pyRes.json());
    } catch (e) {
      return res.status(502).json({ error: `Analysis service unreachable: ${(e as Error).message}` });
    }
  },
);

router.get("/template", async (_req, res) => {
  try {
    const pyRes = await fetch(`${PYTHON_URL()}/gst-template`, { headers: internalHeaders(), signal: AbortSignal.timeout(120_000) });
    if (!pyRes.ok) {
      const { status, message } = await relayError(pyRes, "Template unavailable");
      return res.status(status).json({ error: message });
    }
    const xlsx = Buffer.from(await pyRes.arrayBuffer());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="CreditGuard_GST_summary_template.xlsx"');
    res.setHeader("Content-Length", xlsx.length);
    return res.send(xlsx);
  } catch (e) {
    return res.status(502).json({ error: `Analysis service unreachable: ${(e as Error).message}` });
  }
});

export default router;
