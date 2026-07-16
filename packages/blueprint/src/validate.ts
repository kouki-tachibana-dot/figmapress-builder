import { SiteBlueprintSchema } from "./schema";
import type { SiteBlueprint } from "./types";

export interface ValidationResult {
  ok: boolean;
  data?: SiteBlueprint;
  errors: string[];
}

export function validateBlueprint(input: unknown): ValidationResult {
  const parsed = SiteBlueprintSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
      ),
    };
  }
  return { ok: true, data: parsed.data as SiteBlueprint, errors: [] };
}

export function assertBlueprint(input: unknown): SiteBlueprint {
  const result = validateBlueprint(input);
  if (!result.ok || !result.data) {
    throw new Error(
      `Invalid Site Blueprint:\n  - ${result.errors.join("\n  - ")}`,
    );
  }
  return result.data;
}
