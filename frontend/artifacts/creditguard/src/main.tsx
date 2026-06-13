import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// On Vercel (static build), point API calls at the deployed Express server.
// In dev, VITE_API_URL is empty so relative /api/* paths go through vite proxy.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
if (apiUrl) setBaseUrl(apiUrl);

// Warm up both backend services on app load so Render free-tier instances are
// awake before the user tries to generate a memo or search companies.
fetch("/api/healthz").catch(() => {});
fetch("/api/python-health").catch(() => {});

createRoot(document.getElementById("root")!).render(<App />);
