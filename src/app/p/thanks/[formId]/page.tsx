import { CheckCircle2 } from "lucide-react";
import { LeadMagnet } from "@/components/funnels/LeadMagnet";
import { PublicFooter } from "@/components/funnels/Blocks";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: `Thank you · ${BRAND.name}` } };

export default async function ThanksPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <section className="flex-1 bg-[#6a1b9a] px-6 py-20 text-center text-white">
        <CheckCircle2 className="mx-auto h-12 w-12" />
        <h1 className="mt-4 font-serif text-3xl font-bold">Thank you</h1>
        <p className="mx-auto mt-3 max-w-md text-white/85">Pamela and the {BRAND.name} team will be in touch soon. If it&apos;s urgent, call {BRAND.phoneDisplay}.</p>
      </section>
      <LeadMagnet formId={formId} />
      <PublicFooter />
    </main>
  );
}
