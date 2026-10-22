import { Tabs } from "@/components/ui";

export function SocialTabs({ active }: { active: "/social" | "/social/posts" | "/social/inbox" }) {
  return (
    <Tabs
      active={active}
      tabs={[
        { href: "/social", label: "Comment-to-DM" },
        { href: "/social/posts", label: "Posts" },
        { href: "/social/inbox", label: "Inbox" },
      ]}
    />
  );
}
