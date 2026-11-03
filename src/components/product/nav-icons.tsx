//
// NavIcon key → lucide icon. The nav lists (src/lib/app-nav.ts) name icons by
// key so they can cross from a server layout into the client sidebar; this is
// the one place a key becomes a component.
//

import {
  ArrowLeftIcon,
  BotIcon,
  CreditCardIcon,
  FileTextIcon,
  HistoryIcon,
  HouseIcon,
  ImageIcon,
  LayoutGridIcon,
  MailIcon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
  SettingsIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/app-nav";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  home: HouseIcon,
  billing: CreditCardIcon,
  feedback: MessageSquareIcon,
  settings: SettingsIcon,
  admin: ShieldIcon,
  overview: LayoutGridIcon,
  users: UsersIcon,
  content: PanelsTopLeftIcon,
  posts: FileTextIcon,
  media: ImageIcon,
  plans: TagIcon,
  subscribers: MailIcon,
  agents: BotIcon,
  audit: HistoryIcon,
  back: ArrowLeftIcon,
};
