import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { Button, Input, Field } from "@/components/ui";
import { AuthFrame } from "@/components/AuthFrame";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const db = await getDb();
  const [{ value }] = await db.select({ value: count() }).from(schema.users);
  if (Number(value) > 0) redirect("/login");
  const { error } = await searchParams;
  return (
    <AuthFrame title="Set up Pamela OS">
      <p className="mb-4 text-center text-sm text-zinc-500">Create the owner account. This is the only account — everything inside is yours.</p>
      <form action="/api/auth/login?setup=1" method="post" className="space-y-4">
        <Field label="Your name">
          <Input name="name" defaultValue="Pamela" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" minLength={10} required />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full" size="lg">
          Create account
        </Button>
      </form>
    </AuthFrame>
  );
}
