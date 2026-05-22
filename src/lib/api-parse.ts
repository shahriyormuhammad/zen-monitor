import { z } from 'zod';
import { AppError } from '@/lib/errors';

/**
 * Parse and validate URL search params against a zod schema.
 * Throws AppError(400) on validation failure — picked up by apiRoute wrapper.
 */
export function parseRequestQuery<T>(request: Request, schema: z.ZodSchema<T>): T {
  const { searchParams } = new URL(request.url);
  const raw = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      result.error.issues.map((e) => e.message).join('; '),
      400,
    );
  }
  return result.data;
}

/**
 * Parse and validate JSON request body against a zod schema.
 * Throws AppError(400) on invalid JSON or validation failure.
 */
export async function parseRequestBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('Invalid JSON body', 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      result.error.issues.map((e) => e.message).join('; '),
      400,
    );
  }
  return result.data;
}
