export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const DEFAULT_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

export function toolAnnotations(overrides?: ToolAnnotations): ToolAnnotations {
  return { ...DEFAULT_ANNOTATIONS, ...overrides };
}
