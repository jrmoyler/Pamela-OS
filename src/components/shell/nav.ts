import {
  Sun,
  Bot,
  CheckCircle2,
  Users,
  KanbanSquare,
  Mic,
  PhoneCall,
  LayoutTemplate,
  CalendarDays,
  Send,
  MessageCircleHeart,
  Clapperboard,
  Palette,
  Music,
  AudioLines,
  ListTodo,
  Workflow,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Daily",
    items: [
      { href: "/", label: "Today", icon: Sun },
      { href: "/rj", label: "RJ · Operator", icon: Bot },
      { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
      { href: "/work", label: "Work", icon: ListTodo },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/pipelines", label: "Pipelines", icon: KanbanSquare },
      { href: "/meetings", label: "Meetings", icon: Mic },
      { href: "/receptionist", label: "Receptionist", icon: PhoneCall },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/funnels", label: "Pages & Forms", icon: LayoutTemplate },
      { href: "/booking", label: "Booking", icon: CalendarDays },
      { href: "/campaigns", label: "Email & Text", icon: Send },
      { href: "/social", label: "Social & DMs", icon: MessageCircleHeart },
    ],
  },
  {
    label: "Studios",
    items: [
      { href: "/studio/video", label: "Video clips", icon: Clapperboard },
      { href: "/studio/design", label: "Design", icon: Palette },
      { href: "/studio/music", label: "Music", icon: Music },
      { href: "/studio/voice", label: "Her voice", icon: AudioLines },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/automations", label: "Automations", icon: Workflow },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];
