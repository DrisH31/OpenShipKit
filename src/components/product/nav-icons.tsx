//
// NavIcon key → lucide icon. The nav lists (src/lib/app-nav.ts) name icons by
// key so they can cross from a server layout into the client sidebar; this is
// the one place a key becomes a component.
//

import {
  ArrowLeftIcon,
  BotIcon,
  Building2Icon,
  CreditCardIcon,
  FileTextIcon,
  HistoryIcon,
  HouseIcon,
  ImageIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MailIcon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
  SettingsIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/app-nav";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  home: HouseIcon,
  billing: CreditCardIcon,
  feedback: MessageSquareIcon,
  team: UsersRoundIcon,
  settings: SettingsIcon,
  admin: ShieldIcon,
  overview: LayoutGridIcon,
  users: UsersIcon,
  content: PanelsTopLeftIcon,
  posts: FileTextIcon,
  media: ImageIcon,
  plans: TagIcon,
  subscribers: MailIcon,
  orgs: Building2Icon,
  agents: BotIcon,
  jobs: ListChecksIcon,
  audit: HistoryIcon,
  back: ArrowLeftIcon,
};
