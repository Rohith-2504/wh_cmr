"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import {
  LogOut,
  Menu,
  Settings as SettingsIcon,
  User,
  Bell,
  HelpCircle,
  ChevronDown,
  MessageSquare,
  X,
  Mail,
  Phone,
  Clock,
  CheckCheck,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { UniversalSearch } from "@/components/layout/universal-search";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inbox": "Inbox",
  "/contacts": "Contacts",
  "/pipelines": "Pipelines",
  "/broadcasts": "Broadcasts",
  "/automations": "Automations",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "Dashboard";
}

interface RecentMessage {
  id: string;
  contact_name: string;
  body: string;
  created_at: string;
  unread_count: number;
  conversation_id: string;
}

interface NotificationContact {
  full_name: string | null;
  phone_number: string | null;
}

interface NotificationMessage {
  body: string | null;
  created_at: string;
}

interface NotificationRow {
  id: string;
  unread_count: number;
  contacts: NotificationContact | NotificationContact[] | null;
  messages: NotificationMessage[] | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface HeaderProps {
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut, accountRole, profileLoading } = useAuth();
  const title = getPageTitle(pathname);
  const [showHelp, setShowHelp] = useState(false);
  const [notifications, setNotifications] = useState<RecentMessage[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Some synthetic key events (e.g. IME / browser extensions) omit `key`.
      if (!e.key || e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey))
        return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  // Fetch recent unread conversations for the notification panel
  async function loadNotifications() {
    setNotifLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("conversations")
        .select(
          "id, unread_count, contacts(full_name, phone_number), messages(body, created_at)",
        )
        .gt("unread_count", 0)
        .order("last_message_at", { ascending: false })
        .limit(8);

      if (data) {
        const mapped: RecentMessage[] = (data as NotificationRow[]).map((row) => {
          const contact = Array.isArray(row.contacts)
            ? row.contacts[0]
            : row.contacts;
          const msgs = Array.isArray(row.messages) ? row.messages : [];
          const lastMsg = [...msgs].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          )[0];
          return {
            id: row.id,
            conversation_id: row.id,
            contact_name:
              contact?.full_name || contact?.phone_number || "Unknown",
            body: lastMsg?.body || "No message preview",
            created_at: lastMsg?.created_at || new Date().toISOString(),
            unread_count: row.unread_count,
          };
        });
        setNotifications(mapped);
      }
    } catch {
      // silently fail — notifications are non-critical
    } finally {
      setNotifLoading(false);
    }
  }

  const totalUnread = notifications.reduce((s, n) => s + n.unread_count, 0);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 shadow-sm">

        {/* ── LEFT: Hamburger (mobile) + Brand logo + name ── */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Hamburger — mobile only */}
          <button
            type="button"
            onClick={() => onOpenSidebar?.()}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Brand — desktop only */}
          <Link href="/dashboard" className="hidden lg:flex items-center gap-2.5 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm">
              <Image
                src="/Sites(Color).webp"
                alt="StartBusinezz CRM Logo"
                width={36}
                height={36}
                className="h-9 w-9 object-contain"
              />
            </div>
            <span className="text-sm font-semibold text-foreground whitespace-nowrap">
              StartBusinezz CRM
            </span>
          </Link>

          {/* Separator */}
          <div className="hidden lg:block h-5 w-px bg-border/60" />

          {/* Page title — mobile */}
          <h1 className="truncate text-sm font-semibold text-foreground sm:text-base lg:hidden">
            {title}
          </h1>
        </div>

        {/* ── CENTER: Universal search ── */}
        <div className="hidden flex-1 items-center justify-center min-w-0 px-4 md:flex">
          <UniversalSearch
            inputRef={searchInputRef}
            className="max-w-sm"
          />
        </div>

        {/* ── RIGHT: Notification + Help + Mode toggle + Profile ── */}
        <div className="flex items-center gap-2 shrink-0">
          {/* ── Notification Bell with Dropdown ── */}
          <DropdownMenu open={notifOpen} onOpenChange={(v) => {
            setNotifOpen(v);
            if (v) loadNotifications();
          }}>
          <DropdownMenuTrigger
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {/* Only show red dot if there are unread conversations */}
              {totalUnread > 0 && (
                <span className="absolute right-2 top-2 flex h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-80 p-0 bg-popover border-border shadow-xl rounded-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Notifications</span>
                  {totalUnread > 0 && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                      {totalUnread}
                    </span>
                  )}
                </div>
                <Link
                  href="/inbox"
                  className="text-[10px] text-primary hover:underline font-medium"
                  onClick={() => setNotifOpen(false)}
                >
                  View all
                </Link>
              </div>

              {/* Body */}
              <div
                className="max-h-80 overflow-y-auto"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {notifLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <CheckCheck className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">All caught up!</p>
                    <p className="text-xs text-muted-foreground">No recent activity or unread messages.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border/50">
                    {notifications.map((notif) => (
                      <li key={notif.id}>
                        <Link
                          href={`/inbox?conversation=${notif.conversation_id}`}
                          onClick={() => setNotifOpen(false)}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                            {notif.contact_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <p className="text-xs font-semibold text-foreground truncate">
                                {notif.contact_name}
                              </p>
                              <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                {timeAgo(notif.created_at)}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {notif.body}
                            </p>
                          </div>
                          {notif.unread_count > 0 && (
                            <span className="mt-1 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                              {notif.unread_count}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* ── Help / Contact Us button ── */}
          <button
            onClick={() => setShowHelp(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>

          <ModeToggle />

          {/* Profile pill — right side */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-2.5 rounded-2xl border border-border/80 bg-muted/30 px-2.5 py-1.5 transition-colors hover:bg-muted/60 focus:outline-none data-[state=open]:bg-muted/60"
              aria-label="Open account menu"
            >
              {/* Avatar on left */}
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col text-left sm:flex leading-tight">
                <span className="text-xs font-bold text-foreground whitespace-nowrap">
                  {profile?.full_name ?? "User"}
                </span>
                <span className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider">
                  {profileLoading
                    ? "…"
                    : accountRole
                      ? accountRole.charAt(0).toUpperCase() + accountRole.slice(1)
                      : "Member"}
                </span>
              </div>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={() => router.push("/settings?tab=profile")}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push("/settings?tab=whatsapp")}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <SettingsIcon className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ── Help / Contact Us Modal ── */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="relative mx-4 w-full max-w-sm rounded-2xl border border-border/60 bg-card shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowHelp(false)}
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <HelpCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">Contact Us</h2>
                <p className="text-xs text-muted-foreground">We&apos;re here to help</p>
              </div>
            </div>

            {/* Contact details */}
            <div className="space-y-3">
              <a
                href="mailto:support@startbusinezz.com"
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm transition-colors hover:bg-muted/60 group"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Email</p>
                  <p className="text-sm font-medium text-foreground">support@startbusinezz.com</p>
                </div>
              </a>

              <a
                href="https://wa.me/917975931377"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm transition-colors hover:bg-muted/60 group"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                  <MessageSquare className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">WhatsApp</p>
                  <p className="text-sm font-medium text-foreground">+91 79759 31377</p>
                </div>
              </a>

              <a
                href="tel:+917975931377"
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm transition-colors hover:bg-muted/60 group"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                  <Phone className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Phone</p>
                  <p className="text-sm font-medium text-foreground">+91 79759 31377</p>
                </div>
              </a>
            </div>

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              Support hours: Mon – Sat, 9 AM – 7 PM IST
            </p>
          </div>
        </div>
      )}
    </>
  );
}
