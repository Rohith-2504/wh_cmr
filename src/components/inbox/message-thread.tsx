"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  Tag,
} from "@/types";
import {
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  MoreVertical,
  LogOut,
  Trash2,
  Eraser,
  Ban,
  Loader2,
  CircleDot,
} from "lucide-react";
import { differenceInHours } from "date-fns";
import {
  formatDateSeparatorLabel,
  localDayKey,
} from "@/lib/dashboard/date-utils";
import { Badge } from "@/components/ui/badge";
import {
  InboxActionMenu,
  InboxAssignFilter,
  InboxContactTagAssign,
  INBOX_FILTER_OPTION_CLASS,
  InboxSingleSelectFilter,
} from "@/components/inbox/inbox-filter-dropdown";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  onContactTagsChange?: (contactId: string, tagIds: string[]) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
  /** Fired after the conversation row is deleted from the DB. */
  onConversationDeleted?: (conversationId: string) => void;
  /** Fired after all messages in the conversation are cleared. */
  onChatCleared?: (conversationId: string) => void;
}

type ChatMenuAction = "delete" | "clear" | "block";

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = localDayKey(msg.created_at);
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-[var(--wa-green)]" },
  { label: "Pending", value: "pending", color: "text-amber-500" },
  { label: "Closed", value: "closed", color: "wa-text-muted" },
];

/**
 * WhatsApp-style doodle background for the chat area. Colors and tile
 * are driven by `.inbox-wa` CSS variables in globals.css.
 */
const DOODLE_BG_CLASSES = "wa-chat-bg bg-repeat";

interface ThreadContextMenuState {
  x: number;
  y: number;
}

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onContactTagsChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
  onConversationDeleted,
  onChatCleared,
}: MessageThreadProps) {
  const { user } = useAuth();
  const canAct = useCan("send-messages");
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [threadContextMenu, setThreadContextMenu] =
    useState<ThreadContextMenuState | null>(null);
  const [pendingChatAction, setPendingChatAction] =
    useState<ChatMenuAction | null>(null);
  const [chatActionLoading, setChatActionLoading] = useState(false);

  const closeThreadContextMenu = useCallback(() => {
    setThreadContextMenu(null);
  }, []);

  const handleThreadContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-message-actions]")) return;
    e.preventDefault();
    setThreadContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!threadContextMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      const menu = document.getElementById("thread-context-menu");
      if (menu?.contains(event.target as Node)) return;
      closeThreadContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeThreadContextMenu();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [threadContextMenu, closeThreadContextMenu]);

  const handleExitChat = useCallback(() => {
    closeThreadContextMenu();
    onBack?.();
  }, [closeThreadContextMenu, onBack]);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Account tags + this contact's tag assignments for the header picker.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    supabase
      .from("tags")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch tags:", error);
          return;
        }
        setAllTags((data as Tag[]) ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const contactId = contact?.id;

  useEffect(() => {
    if (!contactId) {
      setContactTagIds([]);
      return;
    }

    let cancelled = false;
    const supabase = createClient();

    supabase
      .from("contact_tags")
      .select("tag_id")
      .eq("contact_id", contactId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch contact tags:", error);
          return;
        }
        setContactTagIds((data ?? []).map((row) => row.tag_id));
      });

    return () => {
      cancelled = true;
    };
  }, [contactId, resyncToken]);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) return { expired: true, remaining: "No customer messages" };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: "Expired" };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h remaining`
        : `${Math.floor(hoursLeft * 60)}m remaining`;

    return { expired, remaining };
  }, [messages]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange],
  );

  const handleTagSelect = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      if (!canAct) {
        toast.error("Read-only — your role can't assign tags");
        return;
      }
      if (contactTagIds.includes(tagId)) return;

      const supabase = createClient();

      if (contactTagIds.length > 0) {
        const { error: deleteError } = await supabase
          .from("contact_tags")
          .delete()
          .eq("contact_id", contact.id);
        if (deleteError) {
          console.error("Failed to replace contact tag:", deleteError);
          toast.error("Failed to update tag");
          return;
        }
      }

      const { error: insertError } = await supabase
        .from("contact_tags")
        .insert({ contact_id: contact.id, tag_id: tagId });

      if (insertError) {
        console.error("Failed to assign contact tag:", insertError);
        toast.error("Failed to assign tag");
        return;
      }

      const nextTagIds = [tagId];
      setContactTagIds(nextTagIds);
      onContactTagsChange?.(contact.id, nextTagIds);
    },
    [canAct, contact, contactTagIds, onContactTagsChange],
  );

  const handleTagUnassign = useCallback(async () => {
    if (!contact || contactTagIds.length === 0) return;
    if (!canAct) {
      toast.error("Read-only — your role can't assign tags");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", contact.id);

    if (error) {
      console.error("Failed to remove contact tag:", error);
      toast.error("Failed to remove tag");
      return;
    }

    setContactTagIds([]);
    onContactTagsChange?.(contact.id, []);
  }, [canAct, contact, contactTagIds.length, onContactTagsChange]);

  const handleDeleteChat = useCallback(async () => {
    if (!conversation || !canAct) return;

    setChatActionLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversation.id);

    setChatActionLoading(false);
    setPendingChatAction(null);

    if (error) {
      console.error("Failed to delete chat:", error);
      toast.error("Failed to delete chat");
      return;
    }

    toast.success("Chat deleted");
    onConversationDeleted?.(conversation.id);
  }, [canAct, conversation, onConversationDeleted]);

  const handleClearChat = useCallback(async () => {
    if (!conversation || !canAct) return;

    setChatActionLoading(true);
    const supabase = createClient();
    const { error: messagesError } = await supabase
      .from("messages")
      .delete()
      .eq("conversation_id", conversation.id);

    if (messagesError) {
      setChatActionLoading(false);
      setPendingChatAction(null);
      console.error("Failed to clear chat:", messagesError);
      toast.error("Failed to clear chat");
      return;
    }

    const { error: convError } = await supabase
      .from("conversations")
      .update({
        last_message_text: null,
        last_message_at: null,
        unread_count: 0,
      })
      .eq("id", conversation.id);

    setChatActionLoading(false);
    setPendingChatAction(null);

    if (convError) {
      console.error("Failed to update conversation after clear:", convError);
      toast.error("Messages cleared, but conversation preview failed to update");
    } else {
      toast.success("Chat cleared");
    }

    setReactions([]);
    onMessagesLoaded([]);
    onChatCleared?.(conversation.id);
  }, [canAct, conversation, onChatCleared, onMessagesLoaded]);

  const handleBlockChat = useCallback(() => {
    setPendingChatAction(null);
    toast.info("Blocking contacts is not available yet.");
  }, []);

  const handleConfirmChatAction = useCallback(() => {
    if (pendingChatAction === "delete") void handleDeleteChat();
    else if (pendingChatAction === "clear") void handleClearChat();
    else if (pendingChatAction === "block") handleBlockChat();
  }, [handleBlockChat, handleClearChat, handleDeleteChat, pendingChatAction]);

  const openChatAction = useCallback(
    (action: ChatMenuAction) => {
      if (!canAct) {
        toast.error("Read-only — your role can't manage chats");
        return;
      }
      setPendingChatAction(action);
    },
    [canAct],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div
        className={cn(
          "relative flex flex-1 flex-col",
          DOODLE_BG_CLASSES,
        )}
      />
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";
  const assignedTag = allTags.find((t) => contactTagIds.includes(t.id));
  const tagLabel = assignedTag?.name ?? "Assign tag";

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        DOODLE_BG_CLASSES,
      )}
      onContextMenu={handleThreadContextMenu}
    >
      {/* Chat header — pinned while messages scroll beneath */}
      <div className="wa-header sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full wa-text-muted transition-colors hover:bg-[var(--wa-hover-row)] lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--wa-search-bg)] text-sm font-medium">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-normal leading-tight">
              {displayName}
            </h2>
            <p className="truncate text-xs wa-text-muted">{contact.phone}</p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "ml-1 hidden gap-1 border-[var(--wa-border)] bg-transparent text-[10px] sm:inline-flex sm:ml-2",
              sessionInfo.expired
                ? "text-red-500"
                : "text-[var(--wa-green)]",
            )}
          >
            <Clock className="h-3 w-3" />
            {sessionInfo.remaining}
          </Badge>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1">
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? "Hide contact panel" : "Show contact panel"
              }
              aria-pressed={contactPanelOpen}
              title={contactPanelOpen ? "Hide contact" : "Show contact"}
              className={cn(
                "hidden h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--wa-hover-row)] lg:inline-flex",
                contactPanelOpen
                  ? "text-[var(--wa-green)]"
                  : "wa-text-muted",
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-5 w-5" />
              ) : (
                <PanelRightOpen className="h-5 w-5" />
              )}
            </button>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh conversation"
              title="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full wa-text-muted transition-colors hover:bg-[var(--wa-hover-row)] disabled:opacity-60"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          <InboxSingleSelectFilter
            ariaLabel="Conversation status"
            panelTitle="Set status"
            icon={<CircleDot className="h-3.5 w-3.5" strokeWidth={1.75} />}
            defaultLabel="Status"
            defaultValue="open"
            value={conversation.status}
            options={STATUS_OPTIONS.map((opt) => ({
              label: opt.label,
              value: opt.value,
            }))}
            onChange={handleStatusChange}
            getOptionClassName={(opt) => {
              const meta = STATUS_OPTIONS.find((s) => s.value === opt.value);
              return meta?.color ?? "text-[var(--wa-text)]";
            }}
            triggerLabelOverride={currentStatus?.label ?? "Status"}
            align="end"
            triggerClassName={cn(
              currentStatus?.color ?? "wa-text-muted",
              "max-w-[6.5rem]",
            )}
          />

          <InboxAssignFilter
            assignLabel={assignLabel}
            options={profiles.map((p) => {
              const isSelected = p.user_id === assignedAgentId;
              const presence = getPresence(p.user_id);
              return {
                userId: p.user_id,
                label: `${p.full_name}${p.user_id === user?.id ? " (me)" : ""}`,
                selected: isSelected,
                leading: (
                  <PresenceDot
                    status={presence}
                    label={presenceLabel(
                      presence,
                      getRow(p.user_id)?.last_seen_at ?? null,
                      now,
                    )}
                  />
                ),
              };
            })}
            onSelect={handleAssignChange}
            onUnassign={
              assignedAgentId
                ? () => void handleAssignChange(null)
                : undefined
            }
            align="end"
          />

          <InboxContactTagAssign
            tagLabel={tagLabel}
            options={allTags.map((tag) => ({
              id: tag.id,
              name: tag.name,
              color: tag.color,
              selected: contactTagIds.includes(tag.id),
            }))}
            onSelect={(tagId) => void handleTagSelect(tagId)}
            onUnassign={
              contactTagIds.length > 0
                ? () => void handleTagUnassign()
                : undefined
            }
            disabled={!canAct}
            align="end"
          />

          <InboxActionMenu
            ariaLabel="More options"
            panelTitle="Chat options"
            triggerIcon={
              <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
            }
            triggerClassName="h-10 w-10 justify-center px-0"
            align="end"
            items={[
              ...(onBack
                ? [
                    {
                      label: "Exit chat",
                      icon: <LogOut className="h-4 w-4" />,
                      onClick: handleExitChat,
                    },
                  ]
                : []),
              {
                label: "Delete chat",
                icon: <Trash2 className="h-4 w-4" />,
                onClick: () => openChatAction("delete"),
                disabled: !canAct,
                destructive: true,
              },
              {
                label: "Clear chat",
                icon: <Eraser className="h-4 w-4" />,
                onClick: () => openChatAction("clear"),
                disabled: !canAct,
              },
              {
                label: "Block chat",
                icon: <Ban className="h-4 w-4" />,
                onClick: () => openChatAction("block"),
                disabled: !canAct,
              },
            ]}
          />
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[5%] py-3 sm:px-[8%]"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--wa-green)] border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm wa-text-muted">No messages yet</p>
            <p className="text-xs wa-text-muted">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {messageGroups.map((group) => (
              <div key={group.date}>
                <div className="mb-3 mt-1 flex items-center justify-center">
                  <span className="wa-date-pill rounded-lg px-3 py-1.5 text-xs shadow-sm">
                    {formatDateSeparatorLabel(group.date)}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      <Dialog
        open={pendingChatAction !== null}
        onOpenChange={(open) => {
          if (!open && !chatActionLoading) setPendingChatAction(null);
        }}
      >
        <DialogContent className="border-[var(--wa-border)] bg-[var(--wa-panel)] text-[var(--wa-text)] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[var(--wa-text)]">
              {pendingChatAction === "delete" && "Delete chat"}
              {pendingChatAction === "clear" && "Clear chat"}
              {pendingChatAction === "block" && "Block chat"}
            </DialogTitle>
            <DialogDescription className="wa-text-muted">
              {pendingChatAction === "delete" && (
                <>
                  Delete this conversation with{" "}
                  <span className="font-medium text-[var(--wa-text)]">
                    {displayName}
                  </span>
                  ? All messages will be permanently removed. This cannot be
                  undone.
                </>
              )}
              {pendingChatAction === "clear" && (
                <>
                  Remove all messages in this chat with{" "}
                  <span className="font-medium text-[var(--wa-text)]">
                    {displayName}
                  </span>
                  ? The conversation will stay in your inbox.
                </>
              )}
              {pendingChatAction === "block" && (
                <>
                  Block{" "}
                  <span className="font-medium text-[var(--wa-text)]">
                    {displayName}
                  </span>
                  ? You will no longer receive messages from this contact.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-[var(--wa-border)] bg-[var(--wa-panel)]">
            <Button
              variant="outline"
              onClick={() => setPendingChatAction(null)}
              disabled={chatActionLoading}
              className="border-[var(--wa-border)] wa-text-muted hover:bg-[var(--wa-hover-row)]"
            >
              Cancel
            </Button>
            <Button
              variant={
                pendingChatAction === "delete" ? "destructive" : "default"
              }
              onClick={handleConfirmChatAction}
              disabled={chatActionLoading}
              className={
                pendingChatAction === "clear" || pendingChatAction === "block"
                  ? "bg-[var(--wa-green)] text-white hover:bg-[var(--wa-green)]/90"
                  : undefined
              }
            >
              {chatActionLoading && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {pendingChatAction === "delete" && "Delete chat"}
              {pendingChatAction === "clear" && "Clear chat"}
              {pendingChatAction === "block" && "Block chat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {threadContextMenu && (
        <div
          id="thread-context-menu"
          role="menu"
          className="fixed z-50 min-w-44 rounded-lg border border-[var(--wa-border)] bg-[var(--wa-panel)] p-0 text-[var(--wa-text)] shadow-md"
          style={{ left: threadContextMenu.x, top: threadContextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="border-b border-[var(--wa-border)] px-3 py-2">
            <span className="text-[13px] font-medium text-[var(--wa-text)]">
              Chat options
            </span>
          </div>
          <div className="py-1">
            {onBack && (
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleExitChat();
                }}
                className={cn(
                  INBOX_FILTER_OPTION_CLASS,
                  "w-full text-left text-[13px] text-[var(--wa-text)]",
                )}
              >
                <LogOut className="h-4 w-4 wa-text-muted" />
                Exit chat
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
