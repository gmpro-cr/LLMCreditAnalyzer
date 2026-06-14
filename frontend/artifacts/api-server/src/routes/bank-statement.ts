import { Router } from "express";
import multer from "multer";
import { PYTHON_URL, internalHeaders } from "../lib/python.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/excel", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { buffer, originalname, mimetype } = req.file;
  const periodFrom = (req.body.periodFrom || "").toString();
  const periodTo = (req.body.periodTo || "").toString();
  const accountHolder = (req.body.accountHolder || "").toString();

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: mimetype }), originalname);
  if (periodFrom) formData.append("period_from", periodFrom);
  if (periodTo) formData.append("period_to", periodTo);
  if (accountHolder) formData.append("account_holder", accountHolder);

  try {
    const pyRes = await fetch(`${PYTHON_URL()}/analyze-bank-statement/excel`, {
      method: "POST",
      headers: internalHeaders(),
      body: formData,
      signal: AbortSignal.timeout(180_000),
    });
    if (!pyRes.ok) {
      const errBody = await pyRes.text().catch(() => "");
      const parsed = (() => { try { return JSON.parse(errBody); } catch { return null; } })();
      const message = parsed?.detail || errBody || "Excel export failed";
      return res.status(pyRes.status === 400 ? 400 : 502).json({ error: message });
    }
    const xlsx = Buffer.from(await pyRes.arrayBuffer());
    const safe = (accountHolder || "statement").replace(/[^a-zA-Z0-9]+/g, "_") || "statement";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="BankStatementAnalysis_${safe}.xlsx"`);
    res.setHeader("Content-Length", xlsx.length);
    return res.send(xlsx);
  } catch (e) {
    return res.status(502).json({ error: `Analysis service unreachable: ${(e as Error).message}` });
  }
});

router.post("/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { buffer, originalname, mimetype } = req.file;
  const periodFrom = (req.body.periodFrom || "").toString();
  const periodTo = (req.body.periodTo || "").toString();
  const accountHolder = (req.body.accountHolder || "").toString();

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: mimetype }), originalname);
  if (periodFrom) formData.append("period_from", periodFrom);
  if (periodTo) formData.append("period_to", periodTo);
  if (accountHolder) formData.append("account_holder", accountHolder);

  try {
    const pyRes = await fetch(`${PYTHON_URL()}/analyze-bank-statement`, {
      method: "POST",
      headers: internalHeaders(),
      body: formData,
      signal: AbortSignal.timeout(180_000),
    });
    if (!pyRes.ok) {
      const errBody = await pyRes.text().catch(() => "");
      const parsed = (() => { try { return JSON.parse(errBody); } catch { return null; } })();
      const message = parsed?.detail || errBody || "Analysis failed";
      return res.status(pyRes.status === 400 ? 400 : 502).json({ error: message });
    }
    const data = await pyRes.json();
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ error: `Analysis service unreachable: ${(e as Error).message}` });
  }
});

export default router;
