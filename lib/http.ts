import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Extra fields for the browser to act on, sent next to `error`. */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler: HttpError → its status, Zod → 400, anything else → 500 (logged, not leaked). */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid input" }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "Something broke in the dumpster." }, { status: 500 });
    }
  };
}

export const notFound = () => new HttpError(404, "This Dumpster has burned down (or never existed).");
