export function rangeResponse(req: Request, data: Buffer, mime: string, name: string) {
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "content-disposition": `inline; filename="${encodeURIComponent(name)}"`,
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  // Files agents push in can be HTML or SVG; never let them run script with her session.
  if (/html|svg|xml/.test(mime)) headers["content-security-policy"] = "sandbox";
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      let start: number;
      let end: number;
      if (!m[1]) {
        // Suffix range "bytes=-N" means the last N bytes.
        start = Math.max(0, data.length - Number(m[2]));
        end = data.length - 1;
      } else {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
      }
      if (start >= data.length || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${data.length}` } });
      }
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": String(end - start + 1) },
      });
    }
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
