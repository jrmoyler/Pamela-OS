import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb, schema } from "@/lib/db";
import { PageBlocks, PublicFooter } from "@/components/funnels/Blocks";
import { LeadMagnet } from "@/components/funnels/LeadMagnet";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const db = await getDb();
  const [page] = await db.select().from(schema.pages).where(and(eq(schema.pages.slug, slug), eq(schema.pages.published, true)));
  return page ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await load((await params).slug);
  return { title: page ? { absolute: `${page.title} · ${BRAND.name}` } : BRAND.name };
}

export default async function PublicPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ f?: string; error?: string }> }) {
  const { slug } = await params;
  const { f, error } = await searchParams;
  const page = await load(slug);
  if (!page) notFound();
  const db = await getDb();
  await db.update(schema.pages).set({ views: sql`${schema.pages.views} + 1` }).where(eq(schema.pages.id, page.id));
  return (
    <main className="min-h-screen bg-white">
      {error && <div className="bg-red-50 px-6 py-3 text-center text-sm text-red-700">{error}</div>}
      {f && (
        <>
          <div className="bg-[#f3e8f8] px-6 py-3 text-center text-sm font-medium text-[#6a1b9a]">Thank you — we received your note.</div>
          <LeadMagnet formId={f} />
        </>
      )}
      <PageBlocks blocks={page.blocks} pageSlug={page.slug} />
      <PublicFooter />
    </main>
  );
}
