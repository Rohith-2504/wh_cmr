"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Automation, Conversation, ConversationStatus, Tag } from "@/types";
import {
  Calendar,
  CheckCheck,
  Filter,
  MoreVertical,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  InboxActionMenu,
  InboxAutomationsFilter,
  InboxSingleSelectFilter,
  InboxTagFilter,
} from "@/components/inbox/inbox-filter-dropdown";
import {
  formatConversationTime,
  isTodayInAppTz,
  isWithinLastAppDays,
} from "@/lib/dashboard/date-utils";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  /** Bumps parent resyncToken to refetch the list (Chats ⋯ menu). */
  onRefresh?: () => void;
  /** Patches tag filter state when tags change in the thread header. */
  contactTagUpdate?: { contactId: string; tagIds: string[] } | null;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-[var(--wa-green)]",
  pending: "bg-amber-500",
  closed: "bg-[var(--wa-text-muted)]",
};

type InboxFilter =
  | ConversationStatus
  | "all"
  | "unread"
  | "broadcast"
  | "flows"
  | "automations";

type DateFilter = "all" | "today" | "7d" | "30d";

interface InboxFilterSets {
  broadcastContactIds: Set<string>;
  flowConversationIds: Set<string>;
  flowContactIds: Set<string>;
  automationContactIds: Set<string>;
}

/** contact_id → tag ids assigned to that contact */
type ContactTagMap = Map<string, Set<string>>;

/** automation_id → contact ids touched by that automation */
type AutomationContactMap = Map<string, Set<string>>;

const ALL_FILTERS: { label: string; value: InboxFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
  { label: "Broadcast", value: "broadcast" },
  { label: "Flows", value: "flows" },
  { label: "Automations", value: "automations" },
];

const DATE_FILTERS: { label: string; value: DateFilter }[] = [
  { label: "Any time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
];

function matchesDateFilter(
  lastMessageAt: string | undefined,
  dateFilter: DateFilter,
): boolean {
  if (dateFilter === "all" || !lastMessageAt) return dateFilter === "all";
  const date = new Date(lastMessageAt);
  if (dateFilter === "today") return isTodayInAppTz(date);
  if (dateFilter === "7d") return isWithinLastAppDays(date, 7);
  if (dateFilter === "30d") return isWithinLastAppDays(date, 30);
  return true;
}

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  onRefresh,
  contactTagUpdate,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [loading, setLoading] = useState(true);
  const [filterSets, setFilterSets] = useState<InboxFilterSets>({
    broadcastContactIds: new Set(),
    flowConversationIds: new Set(),
    flowContactIds: new Set(),
    automationContactIds: new Set(),
  });
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [allAutomations, setAllAutomations] = useState<
    Pick<Automation, "id" | "name">[]
  >([]);
  const [selectedAutomationIds, setSelectedAutomationIds] = useState<
    string[]
  >([]);
  const [contactTagMap, setContactTagMap] = useState<ContactTagMap>(
    () => new Map(),
  );
  const [automationContactMap, setAutomationContactMap] =
    useState<AutomationContactMap>(() => new Map());

  const effectiveContactTagMap = useMemo(() => {
    if (!contactTagUpdate) return contactTagMap;
    const next = new Map(contactTagMap);
    const { contactId, tagIds } = contactTagUpdate;
    if (tagIds.length === 0) {
      next.delete(contactId);
    } else {
      next.set(contactId, new Set(tagIds));
    }
    return next;
  }, [contactTagMap, contactTagUpdate]);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const [
        convRes,
        flowRes,
        broadcastRes,
        automationLogsRes,
        automationsRes,
        tagsRes,
        contactTagsRes,
      ] = await Promise.all([
          supabase
            .from("conversations")
            .select("*, contact:contacts(*)")
            .order("last_message_at", { ascending: false }),
          supabase
            .from("flow_runs")
            .select("conversation_id, contact_id")
            .in("status", ["active", "paused_by_agent"]),
          supabase.from("broadcast_recipients").select("contact_id"),
          supabase.from("automation_logs").select("automation_id, contact_id"),
          supabase.from("automations").select("id, name").order("name"),
          supabase.from("tags").select("*").order("name"),
          supabase.from("contact_tags").select("contact_id, tag_id"),
        ]);

      if (cancelled) return;

      if (convRes.error) {
        console.error("Failed to fetch conversations:", {
          message: convRes.error.message,
          details: convRes.error.details,
          hint: convRes.error.hint,
          code: convRes.error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(convRes.data ?? []);

      const flowConversationIds = new Set<string>();
      const flowContactIds = new Set<string>();
      for (const row of flowRes.data ?? []) {
        if (row.conversation_id) flowConversationIds.add(row.conversation_id);
        if (row.contact_id) flowContactIds.add(row.contact_id);
      }

      const broadcastContactIds = new Set<string>();
      for (const row of broadcastRes.data ?? []) {
        if (row.contact_id) broadcastContactIds.add(row.contact_id);
      }

      const automationContactIds = new Set<string>();
      const autoContactMap: AutomationContactMap = new Map();
      for (const row of automationLogsRes.data ?? []) {
        if (!row.contact_id) continue;
        automationContactIds.add(row.contact_id);
        if (!row.automation_id) continue;
        const existing = autoContactMap.get(row.automation_id);
        if (existing) {
          existing.add(row.contact_id);
        } else {
          autoContactMap.set(row.automation_id, new Set([row.contact_id]));
        }
      }

      setFilterSets({
        broadcastContactIds,
        flowConversationIds,
        flowContactIds,
        automationContactIds,
      });

      setAllTags(tagsRes.data ?? []);
      setAllAutomations(automationsRes.data ?? []);
      setAutomationContactMap(autoContactMap);

      const tagMap: ContactTagMap = new Map();
      for (const row of contactTagsRes.data ?? []) {
        if (!row.contact_id || !row.tag_id) continue;
        const existing = tagMap.get(row.contact_id);
        if (existing) {
          existing.add(row.tag_id);
        } else {
          tagMap.set(row.contact_id, new Set([row.tag_id]));
        }
      }
      setContactTagMap(tagMap);

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread_count > 0).length,
    [conversations],
  );

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter === "broadcast") {
      result = result.filter((c) =>
        filterSets.broadcastContactIds.has(c.contact_id),
      );
    } else if (filter === "flows") {
      result = result.filter(
        (c) =>
          filterSets.flowConversationIds.has(c.id) ||
          filterSets.flowContactIds.has(c.contact_id),
      );
    } else if (filter === "automations") {
      result = result.filter((c) =>
        filterSets.automationContactIds.has(c.contact_id),
      );
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    if (dateFilter !== "all") {
      result = result.filter((c) =>
        matchesDateFilter(c.last_message_at, dateFilter),
      );
    }

    if (selectedTagIds.length > 0) {
      result = result.filter((c) => {
        const contactTags = effectiveContactTagMap.get(c.contact_id);
        if (!contactTags) return false;
        return selectedTagIds.some((tagId) => contactTags.has(tagId));
      });
    }

    if (selectedAutomationIds.length > 0) {
      result = result.filter((c) =>
        selectedAutomationIds.some((automationId) =>
          automationContactMap.get(automationId)?.has(c.contact_id),
        ),
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [
    conversations,
    filter,
    dateFilter,
    search,
    filterSets,
    selectedTagIds,
    effectiveContactTagMap,
    selectedAutomationIds,
    automationContactMap,
  ]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    [],
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect],
  );

  function filterOptionLabel(opt: { label: string; value: InboxFilter }) {
    if (opt.value === "unread" && unreadCount > 0) {
      return `${opt.label} (${unreadCount})`;
    }
    return opt.label;
  }

  const toggleTagFilter = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  }, []);

  const clearTagFilters = useCallback(() => {
    setSelectedTagIds([]);
  }, []);

  const toggleAutomationFilter = useCallback((automationId: string) => {
    setSelectedAutomationIds((prev) =>
      prev.includes(automationId)
        ? prev.filter((id) => id !== automationId)
        : [...prev, automationId],
    );
  }, []);

  const clearAutomationFilters = useCallback(() => {
    setSelectedAutomationIds([]);
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    const supabase = createClient();
    const unreadIds = conversations
      .filter((c) => c.unread_count > 0)
      .map((c) => c.id);
    const { error } = await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .in("id", unreadIds);
    if (error) {
      console.error("Failed to mark all as read:", error);
      return;
    }
    onConversationsLoaded(
      conversations.map((c) =>
        c.unread_count > 0 ? { ...c, unread_count: 0 } : c,
      ),
    );
  }, [conversations, onConversationsLoaded, unreadCount]);

  const chatsMenuItems = useMemo(() => {
    const items = [];
    if (onRefresh) {
      items.push({
        label: "Refresh conversations",
        icon: <RefreshCw className="h-4 w-4" strokeWidth={1.75} />,
        onClick: onRefresh,
      });
    }
    if (unreadCount > 0) {
      items.push({
        label: "Mark all as read",
        icon: <CheckCheck className="h-4 w-4" strokeWidth={1.75} />,
        onClick: () => void handleMarkAllRead(),
      });
    }
    return items;
  }, [handleMarkAllRead, onRefresh, unreadCount]);

  const emptyListMessage =
    selectedTagIds.length > 0 && selectedAutomationIds.length > 0
      ? "No conversations match selected filters"
      : selectedTagIds.length > 0
        ? "No conversations match selected tags"
        : selectedAutomationIds.length > 0
          ? "No conversations match selected automations"
          : "No conversations found";

  return (
    <div className="wa-panel flex h-full w-full min-w-0 flex-col border-r wa-border">
      {/* List header — WhatsApp "Chats" bar + search pill */}
      <div className="wa-header shrink-0 border-b px-4 pb-3 pt-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[20px] font-normal leading-none">Chats</h2>
          {chatsMenuItems.length > 0 && (
            <InboxActionMenu
              ariaLabel="Chats menu"
              panelTitle="Chats"
              triggerIcon={
                <MoreVertical className="h-5 w-5" strokeWidth={1.75} />
              }
              triggerClassName="h-10 w-10 justify-center rounded-full border-0 bg-transparent px-0 wa-text-muted hover:bg-[var(--wa-hover-row)]"
              align="end"
              items={chatsMenuItems}
            />
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 wa-text-muted" />
          <input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search or start new chat"
            className="wa-search h-[35px] w-full rounded-lg pl-9 pr-3 text-[14px] outline-none placeholder:wa-text-muted focus:ring-1 focus:ring-[var(--wa-green)]/40"
          />
        </div>

        {/* Compact filter dropdowns */}
        <div className="mt-2 flex items-center gap-2">
          <InboxSingleSelectFilter
            ariaLabel="Filter conversations"
            panelTitle="Filter conversations"
            icon={<Filter className="h-3.5 w-3.5" strokeWidth={1.75} />}
            defaultLabel="Filter"
            defaultValue="all"
            options={ALL_FILTERS}
            value={filter}
            onChange={setFilter}
            getOptionLabel={filterOptionLabel}
            triggerClassName="min-w-0 flex-1"
          />
          <InboxSingleSelectFilter
            ariaLabel="Filter by date"
            panelTitle="Filter by date"
            icon={<Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />}
            defaultLabel="Date"
            defaultValue="all"
            options={DATE_FILTERS}
            value={dateFilter}
            onChange={setDateFilter}
            triggerClassName="shrink-0"
            align="center"
          />
          <InboxTagFilter
            tags={allTags}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTagFilter}
            onClear={clearTagFilters}
            align="end"
          />
          <InboxAutomationsFilter
            automations={allAutomations}
            selectedAutomationIds={selectedAutomationIds}
            onToggle={toggleAutomationFilter}
            onClear={clearAutomationFilters}
            align="end"
          />
        </div>

        {(selectedTagIds.length > 0 || selectedAutomationIds.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = allTags.find((t) => t.id === id);
              if (!tag) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTagFilter(id)}
                  aria-label={`Remove ${tag.name} filter`}
                  className="wa-tag-chip inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                  <span aria-hidden className="opacity-60">
                    ×
                  </span>
                </button>
              );
            })}
            {selectedAutomationIds.map((id) => {
              const automation = allAutomations.find((a) => a.id === id);
              if (!automation) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleAutomationFilter(id)}
                  aria-label={`Remove ${automation.name} filter`}
                  className="wa-tag-chip inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--wa-green)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--wa-green)]"
                >
                  <span className="truncate">{automation.name}</span>
                  <span aria-hidden className="opacity-60">
                    ×
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--wa-green)] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm wa-text-muted">{emptyListMessage}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                inFlow={
                  filterSets.flowConversationIds.has(conv.id) ||
                  filterSets.flowContactIds.has(conv.contact_id)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  inFlow?: boolean;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  inFlow,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();
  const hasUnread = conversation.unread_count > 0;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeLabel = formatConversationTime(conversation.last_message_at);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "wa-row-hover flex w-full items-center gap-3 border-b border-[var(--wa-border)]/40 px-3 py-2.5 text-left transition-colors last:border-b-0",
        isActive && "wa-row-active",
      )}
    >
      <div className="flex h-[49px] w-[49px] shrink-0 items-center justify-center rounded-full bg-[var(--wa-search-bg)] text-base font-normal">
        {contact?.avatar_url ? (
          <Image
            src={contact.avatar_url}
            alt={displayName}
            width={49}
            height={49}
            unoptimized
            className="h-[49px] w-[49px] rounded-full object-cover"
          />
        ) : (
          <span className="wa-text-muted">{initials}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[17px] leading-[21px]",
              hasUnread ? "font-medium text-[var(--wa-text)]" : "font-normal",
            )}
          >
            {displayName}
          </span>
          <span
            className={cn(
              "shrink-0 text-[12px] leading-none",
              hasUnread ? "font-normal text-[var(--wa-green)]" : "wa-text-muted",
            )}
          >
            {timeLabel}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              "truncate text-[14px] leading-[20px]",
              hasUnread ? "font-normal text-[var(--wa-text)]" : "wa-text-muted",
            )}
          >
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasUnread && (
              <span className="wa-unread-badge flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none">
                {conversation.unread_count > 99
                  ? "99+"
                  : conversation.unread_count}
              </span>
            )}
            {inFlow && (
              <span
                className="text-[10px] wa-text-muted"
                title="Active flow"
                aria-label="Active flow"
              >
                ⚡
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full opacity-60",
                STATUS_COLORS[conversation.status],
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
