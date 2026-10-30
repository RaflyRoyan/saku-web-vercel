import { zValidator } from "@hono/zod-validator";
import type { z } from "zod";
import { validationError, type FieldErrors } from "./errors.js";

/** Issue zod → `{ field: [pesan] }` (nama field camelCase sesuai body). */
export function fieldErrors(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "body";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/** Validasi body JSON. Gagal → 400 ValidationProblem lewat onError. */
export const jsonBody = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result) => {
    if (!result.success) throw validationError(fieldErrors(result.error));
  });
