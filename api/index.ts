// Entry Vercel Function (runtime Node.js). Semua /api/* di-rewrite ke sini oleh vercel.json;
// URL asli tetap utuh sehingga Hono (`basePath("/api")`) merutekan seperti biasa.
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
