//
// Ready-to-paste MCP client configs for a freshly minted agent key, shown once
// on /admin/agents. The endpoint is always `${siteUrl}/api/mcp` (siteUrl from
// NEXT_PUBLIC_SITE_URL, passed in by the page — never a hard-coded domain).
//
// The server name "openshipkit" is the default; template users can rename it in
// their client without touching the app.
//

export const MCP_SERVER_NAME = "openshipkit";

export interface McpSnippet {
  id: "claude-code" | "cursor" | "json";
  label: string;
  /** Where it goes, in plain words. */
  where: string;
  code: string;
}

/** The MCP endpoint for a site origin (no trailing slash expected; one is removed if present). */
export function mcpEndpoint(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/mcp`;
}

/** Shell-quote for a double-quoted argument. Keys are base64url, but the URL is configuration. */
function dq(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function mcpSnippets(siteUrl: string, key: string): McpSnippet[] {
  const url = mcpEndpoint(siteUrl);
  const auth = `Bearer ${key}`;
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      where: "Run in a terminal, in your project folder.",
      code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${dq(url)} --header ${dq(`Authorization: ${auth}`)}`,
    },
    {
      id: "cursor",
      label: "Cursor",
      where: "Save as .cursor/mcp.json in your project (or merge into it).",
      code: JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url, headers: { Authorization: auth } } } }, null, 2),
    },
    {
      id: "json",
      label: "Other clients",
      where: "Most MCP clients accept an HTTP server in this shape.",
      code: JSON.stringify({ [MCP_SERVER_NAME]: { type: "http", url, headers: { Authorization: auth } } }, null, 2),
    },
  ];
}
