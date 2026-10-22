import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Resolves a writable local directory: the explicit override, else ./<name> under the app.
 * Serverless hosts (Vercel, Lambda) mount the app read-only, so when that fails we fall back
 * to the OS temp dir. That copy is ephemeral and per-instance — fine for a first boot or a
 * demo, but set DATABASE_URL / Supabase Storage for anything real.
 */
export function localDir(name: string, override?: string): string {
  if (override) {
    fs.mkdirSync(override, { recursive: true });
    return override;
  }
  const preferred = path.join(process.cwd(), name);
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EROFS" && code !== "EACCES" && code !== "EPERM") throw e;
    const fallback = path.join(os.tmpdir(), "pamela-os", name);
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(`[pamela-os] ${preferred} is read-only; using ephemeral ${fallback}. Data here will not persist.`);
    return fallback;
  }
}
