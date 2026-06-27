import type { SupabaseClient } from "@supabase/supabase-js";

export type UniversalSearchResultType =
  | "contact"
  | "conversation"
  | "message"
  | "tag"
  | "broadcast"
  | "automation"
  | "flow"
  | "deal"
  | "pipeline";

export interface UniversalSearchResult {
  id: string;
  type: UniversalSearchResultType;
  title: string;
  subtitle?: string;
  href: string;
}

const LIMIT_PER_TYPE = 5;

/** Escape `%`, `_`, and `\` for PostgREST `ilike` patterns. */
function escapeIlike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Build a `%term%` pattern for ilike filters. */
function ilikePattern(rawQuery: string): string {
  return `%${escapeIlike(rawQuery)}%`;
}

/** PostgREST `.or()` filter string with quoted pattern (safe for commas). */
function orIlike(fields: string[], pattern: string): string {
  const quoted = `"${pattern.replace(/"/g, '\\"')}"`;
  return fields.map((f) => `${f}.ilike.${quoted}`).join(",");
}

function contactLabel(row: {
  name: string | null;
  phone: string | null;
  email?: string | null;
  company?: string | null;
}): { title: string; subtitle?: string } {
  const title = row.name?.trim() || row.phone || "Unknown contact";
  const parts = [row.phone, row.email, row.company].filter(Boolean);
  return { title, subtitle: parts.join(" · ") || undefined };
}

type ContactRow = {
  name: string | null;
  phone: string | null;
};

type ConversationRow = {
  id: string;
  last_message_text: string | null;
  contacts: ContactRow | ContactRow[] | null;
};

function normalizeContact(
  contacts: ContactRow | ContactRow[] | null | undefined,
): ContactRow | null {
  if (!contacts) return null;
  return Array.isArray(contacts) ? contacts[0] ?? null : contacts;
}

function mapConversationRow(row: ConversationRow): UniversalSearchResult {
  const contact = normalizeContact(row.contacts);
  const { title, subtitle } = contactLabel({
    name: contact?.name ?? null,
    phone: contact?.phone ?? null,
  });
  return {
    id: row.id,
    type: "conversation",
    title,
    subtitle: row.last_message_text || subtitle,
    href: `/inbox?c=${row.id}`,
  };
}

/** Run a query; return empty array on error so one table can't break search. */
async function safeRows<T>(
  promise: PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await promise;
  if (error) return [];
  return data ?? [];
}

export async function runUniversalSearch(
  supabase: SupabaseClient,
  rawQuery: string,
): Promise<UniversalSearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];

  const like = ilikePattern(query);

  const [
    contacts,
    conversationsByText,
    conversationsByContact,
    messages,
    tags,
    broadcasts,
    automations,
    flows,
    deals,
    pipelines,
  ] = await Promise.all([
    safeRows(
      supabase
        .from("contacts")
        .select("id, name, phone, email, company")
        .or(orIlike(["name", "phone", "email", "company"], like))
        .order("updated_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("conversations")
        .select("id, last_message_text, contacts(name, phone)")
        .ilike("last_message_text", like)
        .order("last_message_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("conversations")
        .select("id, last_message_text, contacts!inner(name, phone)")
        .or(orIlike(["name", "phone"], like), { referencedTable: "contacts" })
        .order("last_message_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("messages")
        .select(
          "id, content_text, conversation_id, conversations(id, contacts(name, phone))",
        )
        .ilike("content_text", like)
        .order("created_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("tags")
        .select("id, name")
        .ilike("name", like)
        .order("name")
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("broadcasts")
        .select("id, name, status")
        .ilike("name", like)
        .order("updated_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("automations")
        .select("id, name, description")
        .or(orIlike(["name", "description"], like))
        .order("updated_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("flows")
        .select("id, name, status")
        .ilike("name", like)
        .order("updated_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("deals")
        .select("id, title, value, currency, contact:contacts(name)")
        .ilike("title", like)
        .order("updated_at", { ascending: false })
        .limit(LIMIT_PER_TYPE),
    ),

    safeRows(
      supabase
        .from("pipelines")
        .select("id, name")
        .ilike("name", like)
        .order("name")
        .limit(LIMIT_PER_TYPE),
    ),
  ]);

  const results: UniversalSearchResult[] = [];

  for (const row of contacts) {
    const { title, subtitle } = contactLabel(row);
    results.push({
      id: row.id,
      type: "contact",
      title,
      subtitle,
      href: `/contacts?contact=${row.id}`,
    });
  }

  const seenConversationIds = new Set<string>();
  for (const row of [...conversationsByText, ...conversationsByContact]) {
    if (seenConversationIds.has(row.id)) continue;
    seenConversationIds.add(row.id);
    results.push(mapConversationRow(row));
  }

  for (const row of messages) {
    const conv = Array.isArray(row.conversations)
      ? row.conversations[0]
      : row.conversations;
    const contact = normalizeContact(conv?.contacts ?? null);
    const contactName =
      contact?.name?.trim() || contact?.phone || "Conversation";
    const conversationId = conv?.id ?? row.conversation_id;
    results.push({
      id: row.id,
      type: "message",
      title: contactName,
      subtitle: row.content_text?.slice(0, 120) ?? undefined,
      href: conversationId ? `/inbox?c=${conversationId}` : "/inbox",
    });
  }

  for (const row of tags) {
    results.push({
      id: row.id,
      type: "tag",
      title: row.name,
      subtitle: "Tag",
      href: `/contacts?search=${encodeURIComponent(row.name)}`,
    });
  }

  for (const row of broadcasts) {
    results.push({
      id: row.id,
      type: "broadcast",
      title: row.name,
      subtitle: row.status ? `Broadcast · ${row.status}` : "Broadcast",
      href: `/broadcasts/${row.id}`,
    });
  }

  for (const row of automations) {
    results.push({
      id: row.id,
      type: "automation",
      title: row.name,
      subtitle: row.description || "Automation",
      href: `/automations/${row.id}/edit`,
    });
  }

  for (const row of flows) {
    results.push({
      id: row.id,
      type: "flow",
      title: row.name,
      subtitle: row.status ? `Flow · ${row.status}` : "Flow",
      href: `/flows/${row.id}`,
    });
  }

  for (const row of deals) {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
    results.push({
      id: row.id,
      type: "deal",
      title: row.title,
      subtitle: contact?.name ? `${contact.name} · Deal` : "Deal",
      href: "/pipelines",
    });
  }

  for (const row of pipelines) {
    results.push({
      id: row.id,
      type: "pipeline",
      title: row.name,
      subtitle: "Pipeline",
      href: "/pipelines",
    });
  }

  return results;
}

export const SEARCH_GROUP_LABELS: Record<UniversalSearchResultType, string> = {
  contact: "Contacts",
  conversation: "Conversations",
  message: "Messages",
  tag: "Tags",
  broadcast: "Broadcasts",
  automation: "Automations",
  flow: "Flows",
  deal: "Deals",
  pipeline: "Pipelines",
};

export const SEARCH_GROUP_ORDER: UniversalSearchResultType[] = [
  "contact",
  "conversation",
  "message",
  "tag",
  "broadcast",
  "automation",
  "flow",
  "deal",
  "pipeline",
];
