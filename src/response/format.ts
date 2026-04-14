interface ContentItem {
  type: "text";
  text: string;
  annotations?: { audience?: ("user" | "assistant")[] };
}

interface ToolResult {
  [key: string]: unknown;
  content: ContentItem[];
}

export function formatResponse(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function formatCompactResponse(
  summary: string,
  details?: unknown,
): ToolResult {
  const content: ContentItem[] = [
    { type: "text", text: summary, annotations: { audience: ["user"] } },
  ];

  if (details !== undefined) {
    content.push({
      type: "text",
      text: JSON.stringify(details, null, 2),
      annotations: { audience: ["assistant"] },
    });
  }

  return { content };
}
