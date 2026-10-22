import { inArray } from "drizzle-orm";
import { Phone } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import type { PageBlock } from "@/lib/db/schema";
import { publicFileUrl } from "@/lib/modules/funnels";
import { BRAND } from "@/lib/brand";
import { money } from "@/lib/utils";

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Only same-site links: anchors or internal paths. Anything else is dropped. */
function safeHref(v: unknown) {
  const h = s(v).trim();
  if (h.startsWith("#") || (h.startsWith("/") && !h.startsWith("//"))) return h;
  return "#";
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="mb-4 whitespace-pre-line">
            {p.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : part))}
          </p>
        ))}
    </>
  );
}

const btn = "inline-flex items-center justify-center rounded-lg bg-[#6a1b9a] px-6 py-3 font-semibold text-white hover:bg-[#4a126c]";

/** Renders a page's blocks. Used by the public /p/[slug] route and the builder preview. */
export async function PageBlocks({ blocks, preview = false, pageSlug }: { blocks: PageBlock[]; preview?: boolean; pageSlug?: string }) {
  const db = await getDb();
  const formIds = blocks.filter((b) => b.type === "form" && b.props.formId).map((b) => s(b.props.formId));
  const forms = formIds.length ? await db.select().from(schema.forms).where(inArray(schema.forms.id, formIds)) : [];
  const fileUrl = (id: unknown) => (s(id) ? (preview ? `/api/files/${s(id)}` : publicFileUrl(s(id))) : "");

  return (
    <div className="bg-white text-[#1f1530]">
      {blocks.map((b) => {
        const p = b.props;
        switch (b.type) {
          case "hero":
            return (
              <section key={b.id} className="bg-[#6a1b9a] px-6 py-16 text-center text-white sm:py-24">
                <div className="mx-auto max-w-3xl">
                  {p.imageFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(p.imageFileId)} alt="" className="mx-auto mb-8 max-h-72 rounded-2xl object-cover" />
                  ) : null}
                  <h1 className="font-serif text-3xl font-bold leading-tight sm:text-5xl">{s(p.headline)}</h1>
                  {s(p.subheadline) && <p className="mt-4 text-lg text-white/85">{s(p.subheadline)}</p>}
                  {s(p.buttonText) && (
                    <a href={safeHref(p.buttonHref)} className="mt-8 inline-flex rounded-lg bg-white px-6 py-3 font-semibold text-[#6a1b9a] hover:bg-[#f3e8f8]">
                      {s(p.buttonText)}
                    </a>
                  )}
                </div>
              </section>
            );
          case "text":
            return (
              <section key={b.id} className="px-6 py-12">
                <div className="prose-book mx-auto max-w-2xl text-lg">
                  {s(p.heading) && <h2 className="mb-4 text-2xl font-bold text-[#6a1b9a]">{s(p.heading)}</h2>}
                  <Paragraphs text={s(p.body)} />
                </div>
              </section>
            );
          case "image":
            return p.fileId ? (
              <figure key={b.id} className="mx-auto max-w-3xl px-6 py-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(p.fileId)} alt={s(p.alt)} className="w-full rounded-2xl" />
                {s(p.caption) && <figcaption className="mt-2 text-center font-serif text-sm text-zinc-500">{s(p.caption)}</figcaption>}
              </figure>
            ) : preview ? (
              <Placeholder key={b.id} text="Upload an image" />
            ) : null;
          case "video":
            return p.fileId ? (
              <figure key={b.id} className="mx-auto max-w-3xl px-6 py-8">
                <video src={fileUrl(p.fileId)} controls playsInline className="w-full rounded-2xl bg-black" />
                {s(p.caption) && <figcaption className="mt-2 text-center font-serif text-sm text-zinc-500">{s(p.caption)}</figcaption>}
              </figure>
            ) : preview ? (
              <Placeholder key={b.id} text="Upload a video" />
            ) : null;
          case "form": {
            const form = forms.find((f) => f.id === s(p.formId));
            if (!form) return preview ? <Placeholder key={b.id} text="Pick a form" /> : null;
            return (
              <section key={b.id} id="form" className="bg-[#f3e8f8] px-6 py-14">
                <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm">
                  {s(p.heading) && <h2 className="mb-4 font-serif text-2xl font-bold text-[#6a1b9a]">{s(p.heading)}</h2>}
                  <form action={`/api/public/forms/${form.id}`} method="post" className="space-y-3">
                    {pageSlug && <input type="hidden" name="_page" value={pageSlug} />}
                    <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                    {form.fields.map((f) => (
                      <label key={f.key} className="block">
                        <span className="mb-1 block text-sm font-medium">
                          {f.label}
                          {f.required && <span className="text-[#6a1b9a]"> *</span>}
                        </span>
                        {f.type === "textarea" ? (
                          <textarea name={f.key} required={f.required} disabled={preview} className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2" />
                        ) : f.type === "select" ? (
                          <select name={f.key} required={f.required} disabled={preview} className="h-11 w-full rounded-lg border border-zinc-300 px-3">
                            <option value="">Choose…</option>
                            {(f.options ?? []).map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input type={f.type} name={f.key} required={f.required} disabled={preview} className="h-11 w-full rounded-lg border border-zinc-300 px-3" />
                        )}
                      </label>
                    ))}
                    <button disabled={preview} className={`${btn} w-full`}>
                      {s(p.buttonText) || "Send"}
                    </button>
                  </form>
                </div>
              </section>
            );
          }
          case "booking":
            return (
              <section key={b.id} className="px-6 py-14 text-center">
                <div className="mx-auto max-w-xl">
                  <h2 className="font-serif text-2xl font-bold text-[#6a1b9a]">{s(p.heading)}</h2>
                  {s(p.text) && <p className="mt-2 text-zinc-600">{s(p.text)}</p>}
                  <a href={s(p.slug) ? `/book/${encodeURIComponent(s(p.slug))}` : "/book"} className={`${btn} mt-6`}>
                    See available times
                  </a>
                </div>
              </section>
            );
          case "cta":
            return (
              <section key={b.id} className="px-6 py-14">
                <div className="mx-auto max-w-3xl rounded-2xl bg-[#6a1b9a] p-10 text-center text-white">
                  <h2 className="font-serif text-2xl font-bold sm:text-3xl">{s(p.headline)}</h2>
                  {s(p.text) && <p className="mt-3 text-white/85">{s(p.text)}</p>}
                  {s(p.buttonText) && (
                    <a href={safeHref(p.buttonHref)} className="mt-6 inline-flex rounded-lg bg-white px-6 py-3 font-semibold text-[#6a1b9a]">
                      {s(p.buttonText)}
                    </a>
                  )}
                </div>
              </section>
            );
          case "testimonial":
            return (
              <section key={b.id} className="px-6 py-12">
                <blockquote className="mx-auto max-w-2xl border-l-4 border-[#6a1b9a] pl-6">
                  <p className="font-serif text-xl italic leading-relaxed">“{s(p.quote)}”</p>
                  {s(p.author) && (
                    <footer className="mt-3 text-sm font-semibold text-[#6a1b9a]">
                      {s(p.author)}
                      {s(p.role) && <span className="font-normal text-zinc-500"> · {s(p.role)}</span>}
                    </footer>
                  )}
                </blockquote>
              </section>
            );
          case "product": {
            const cents = Number(p.priceCents) || 0;
            return (
              <section key={b.id} className="px-6 py-14">
                <div className="mx-auto grid max-w-3xl items-center gap-8 rounded-2xl border border-[#6a1b9a]/20 p-8 sm:grid-cols-2">
                  {p.imageFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(p.imageFileId)} alt={s(p.name)} className="w-full rounded-xl" />
                  ) : (
                    <div className="grid aspect-square place-items-center rounded-xl bg-[#f3e8f8] font-serif text-[#6a1b9a]">{BRAND.name}</div>
                  )}
                  <div>
                    <h2 className="font-serif text-2xl font-bold">{s(p.name)}</h2>
                    {s(p.description) && <p className="mt-2 text-zinc-600">{s(p.description)}</p>}
                    <p className="mt-4 text-3xl font-bold text-[#6a1b9a]">{money(cents)}</p>
                    <form action="/api/public/checkout" method="post" className="mt-4">
                      <input type="hidden" name="block" value={b.id} />
                      <input type="hidden" name="page" value={pageSlug ?? ""} />
                      <button disabled={preview || cents <= 0} className={btn}>
                        {s(p.buttonText) || "Buy now"}
                      </button>
                    </form>
                  </div>
                </div>
              </section>
            );
          }
          case "contact":
            return (
              <section key={b.id} className="bg-[#6a1b9a] px-6 py-8 text-center text-white">
                <p className="flex flex-wrap items-center justify-center gap-2 text-lg">
                  <Phone className="h-5 w-5" /> {s(p.text) || "Call or text"}{" "}
                  <a href={`tel:${BRAND.phoneE164}`} className="font-bold underline-offset-4 hover:underline">
                    {BRAND.phoneDisplay}
                  </a>
                </p>
                <p className="mt-1 font-serif text-sm text-white/75">{BRAND.name}</p>
              </section>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div className="mx-6 my-6 rounded-xl border-2 border-dashed border-[#6a1b9a]/30 p-8 text-center text-sm text-[#6a1b9a]/70">{text}</div>;
}

/** Brand footer on every public page. */
export function PublicFooter() {
  return (
    <footer className="border-t border-zinc-100 bg-white px-6 py-6 text-center text-xs text-zinc-500">
      © {new Date().getFullYear()} <span className="font-serif">{BRAND.name}</span> · {BRAND.phoneDisplay}
    </footer>
  );
}
