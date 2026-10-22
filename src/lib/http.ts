export function rangeResponse(req: Request, data: Buffer, mime: string, name: string) {
  const range = req.headers.get("range");
  const headers: Record<string, string> = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "content-disposition": `inline; filename="${encodeURIComponent(name)}"`,
    "cache-control": "private, max-age=3600",
  };
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${data.length}`, "content-length": String(end - start + 1) },
      });
    }
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
