import { eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { publicFileUrl } from "@/lib/modules/funnels";

/** Download card for a form's lead magnet (signed, expiring link). */
export async function LeadMagnet({ formId }: { formId: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(formId)) return null;
  const db = await getDb();
  const [form] = await db.select().from(schema.forms).where(eq(schema.forms.id, formId));
  if (!form?.leadMagnetFileId) return null;
  const [file] = await db.select().from(schema.files).where(eq(schema.files.id, form.leadMagnetFileId));
  if (!file) return null;
  return (
    <div className="mx-auto my-8 max-w-lg rounded-2xl border border-[#6a1b9a]/20 bg-[#f3e8f8] p-6 text-center">
      <p className="font-serif text-lg font-bold text-[#6a1b9a]">Your free download is ready</p>
      <a href={publicFileUrl(file.id, 7 * 86400)} download={file.name} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#6a1b9a] px-5 py-3 font-semibold text-white hover:bg-[#4a126c]">
        <Download className="h-4 w-4" /> {file.name}
      </a>
    </div>
  );
}
