// Default field sets per entity type.
// Comma-separated top-level fields. Nested paths like "author.user.name" pick specific sub-fields.
// Use "*all" to bypass curation and return the raw API response.

export const DEFAULT_PR_FIELDS =
  "id,title,description,state,createdDate,updatedDate," +
  "author.user.name,author.user.displayName,author.status," +
  "fromRef.displayId,toRef.displayId," +
  "reviewers.user.name,reviewers.user.displayName,reviewers.status,reviewers.approved," +
  "properties.commentCount,properties.openTaskCount,properties.resolvedTaskCount,properties.mergeResult";

export const DEFAULT_PROJECT_FIELDS = "key,id,name,description,type,public";

export const DEFAULT_REPOSITORY_FIELDS =
  "slug,id,name,description,state,forkable,project.key,project.name";

export const DEFAULT_BRANCH_FIELDS =
  "id,displayId,type,latestCommit,isDefault,metadata";

export const DEFAULT_COMMIT_FIELDS =
  "id,displayId,message,author.name,author.emailAddress,authorTimestamp,parents.id";

function pickFieldsFromObject(
  source: Record<string, unknown>,
  fieldPaths: string[],
): Record<string, unknown> {
  // Group fields by their top-level key
  const topLevelGroups = new Map<string, string[]>();

  for (const path of fieldPaths) {
    const dotIndex = path.indexOf(".");
    if (dotIndex === -1) {
      topLevelGroups.set(path, []);
    } else {
      const topKey = path.slice(0, dotIndex);
      const rest = path.slice(dotIndex + 1);
      const existing = topLevelGroups.get(topKey) ?? [];
      existing.push(rest);
      topLevelGroups.set(topKey, existing);
    }
  }

  const result: Record<string, unknown> = {};

  for (const [key, subPaths] of topLevelGroups) {
    const value = source[key];
    if (value === undefined) continue;

    if (subPaths.length === 0) {
      // Top-level field, include as-is
      result[key] = value;
    } else if (Array.isArray(value)) {
      // Array: apply sub-field picking to each element
      result[key] = value.map((item) => {
        if (item && typeof item === "object") {
          return pickFieldsFromObject(
            item as Record<string, unknown>,
            subPaths,
          );
        }
        return item;
      });
    } else if (value && typeof value === "object") {
      // Object: recurse with sub-paths
      result[key] = pickFieldsFromObject(
        value as Record<string, unknown>,
        subPaths,
      );
    }
  }

  return result;
}

/**
 * Curate a response object by picking only the specified fields.
 *
 * @param data - The raw API response object
 * @param fields - Either a default field string (comma-separated paths), "*all" for no filtering,
 *                 or a custom comma-separated field list
 * @returns The curated object with only the requested fields
 */
export function curateResponse(
  data: Record<string, unknown>,
  fields: string,
): Record<string, unknown> {
  if (fields === "*all") {
    return data;
  }

  const fieldPaths = fields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  return pickFieldsFromObject(data, fieldPaths);
}

/**
 * Curate an array of response objects.
 */
export function curateList(
  items: Record<string, unknown>[],
  fields: string,
): Record<string, unknown>[] {
  if (fields === "*all") {
    return items;
  }
  return items.map((item) => curateResponse(item, fields));
}
