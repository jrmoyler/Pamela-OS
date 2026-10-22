import { Tabs } from "@/components/ui";

export function FunnelTabs({ active }: { active: "/funnels" | "/funnels/forms" | "/funnels/payments" }) {
  return (
    <Tabs
      active={active}
      tabs={[
        { href: "/funnels", label: "Pages" },
        { href: "/funnels/forms", label: "Forms" },
        { href: "/funnels/payments", label: "Payments" },
      ]}
    />
  );
}
