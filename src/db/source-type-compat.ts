import type { SourceType } from "./schema.js";

/**
 * The live Studio database's legacy enum is owned by an inaccessible provisioning role and only
 * contains search/followers/likers. New likers jobs are rejected by the API and both affected
 * tables were empty when this compatibility shim was introduced, so the retired value is safe to
 * use as the storage representation for engagers until Deploro can repair the enum ownership.
 */
export function toStudioSourceType(sourceType: SourceType): Exclude<SourceType, "engagers"> {
  return sourceType === "engagers" ? "likers" : sourceType;
}

export function fromStudioSourceType(sourceType: SourceType): SourceType {
  return sourceType === "likers" ? "engagers" : sourceType;
}

export function normalizeStudioSourceType<T extends { sourceType: SourceType }>(row: T): T {
  const sourceType = fromStudioSourceType(row.sourceType);
  return sourceType === row.sourceType ? row : { ...row, sourceType };
}
