/** The credit agent service (credit-analyst-agent) — URL + shared-secret auth. */

export const AGENT_URL = (): string => (process.env.AGENT_SERVICE_URL || "").replace(/\/+$/, "");

export const agentConfigured = (): boolean => !!AGENT_URL() && !!process.env.AGENT_API_TOKEN;

/** Headers for calls to the agent; it refuses any call without its token. */
export function agentHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(extra ?? {}), "x-agent-token": process.env.AGENT_API_TOKEN || "" };
}
