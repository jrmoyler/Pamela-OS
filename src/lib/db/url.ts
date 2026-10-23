/**
 * Cleans up the ways a pasted DATABASE_URL commonly goes wrong, so a copy-paste slip
 * doesn't take the app down:
 *   - surrounding quotes or whitespace
 *   - the variable name pasted into the value (DATABASE_URL=postgresql://…)
 *   - Supabase's [YOUR-PASSWORD] brackets left around the real password
 *   - special characters (# / ? @ : % space) in the password that weren't URL-encoded
 *   - Prisma's ?pgbouncer=true, which Postgres rejects as an unknown setting
 * Returns the URL unchanged when it is already well formed.
 */
export function normalizeDatabaseUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/^DATABASE_URL\s*=\s*/i, "").trim();
  url = url.replace(/^(['"`])(.*)\1$/s, "$2").trim();

  const m = /^(postgres(?:ql)?:\/\/)([^:@/]+):(.*)@([^@]+)$/i.exec(url);
  if (m) {
    const [, scheme, user, rawPass, rest] = m;
    let pass = rawPass;
    if (/^\[.*\]$/.test(pass)) pass = pass.slice(1, -1);
    url = `${scheme}${user}:${encodePassword(pass)}@${rest}`;
  }

  return url.replace(/([?&])pgbouncer=true(&|$)/i, (_, lead: string, tail: string) => (tail ? lead : "")).replace(/\?$/, "");
}

/** Encodes a password unless it is already percent-encoded, so encoding twice can't corrupt it. */
function encodePassword(pass: string): string {
  if (!/[@#/?:\[\]\s%]/.test(pass)) return pass;
  try {
    const decoded = decodeURIComponent(pass);
    // Valid escapes and no raw reserved characters left: the user already encoded it.
    if (decoded !== pass && !/[@#/?:\[\]\s]/.test(pass)) return pass;
  } catch {
    // A stray % that isn't an escape: treat the whole thing as raw.
  }
  return encodeURIComponent(pass);
}
