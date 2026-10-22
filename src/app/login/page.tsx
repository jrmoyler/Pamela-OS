import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { Button, Input, Field } from "@/components/ui";
import { AuthFrame } from "@/components/AuthFrame";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const db = await getDb();
  const [{ value }] = await db.select({ value: count() }).from(schema.users);
  if (Number(value) === 0) redirect("/setup");
  const { next, error } = await searchParams;
  return (
    <AuthFrame title="Welcome back, Pamela">
      <form action="/api/auth/login" method="post" className="space-y-4">
        <input type="hidden" name="next" value={next ?? "/"} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error && <p className="text-sm text-red-600">That email and password don&apos;t match.</p>}
        <Button className="w-full" size="lg">
          Open Pamela OS
        </Button>
      </form>
    </AuthFrame>
  );
}
