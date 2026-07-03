"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Swords,
  PlusCircle,
  MessageCircleReply,
  MessagesSquare,
  CalendarDays,
  Search,
  Megaphone,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/autoreply", label: "Auto-reply", icon: MessageCircleReply },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/telegram-id-search", label: "Telegram ID Search", icon: Search },
  { href: "/group-scrape", label: "Group Scraper", icon: UsersRound },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/campaigns", label: "Campaigns", icon: Swords },
  { href: "/campaigns/new", label: "New campaign", icon: PlusCircle },
  { href: "/broadcasts", label: "Broadcasts", icon: Megaphone },
];

export const SidebarNav = () => {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card/40 md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-5">
        <Swords className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">
          Keyboard Warrior
        </span>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                {
                  "bg-primary text-primary-foreground": isActive,
                  "text-muted-foreground hover:bg-accent hover:text-foreground":
                    !isActive,
                }
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};
