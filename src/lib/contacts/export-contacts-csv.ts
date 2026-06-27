import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Tag } from '@/types';
import { downloadCsv, toCsv } from '@/lib/csv';

const EXPORT_BATCH = 1000;

export interface ContactWithTags extends Contact {
  tags?: Tag[];
}

async function fetchAllFilteredContacts(
  supabase: SupabaseClient,
  search: string,
  tagIds: string[],
  flowIds: string[],
): Promise<Contact[]> {
  const term = search.trim();
  const all: Contact[] = [];

  if (tagIds.length > 0 || flowIds.length > 0) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.rpc('filter_contacts', {
        p_tag_ids: tagIds.length > 0 ? tagIds : null,
        p_flow_ids: flowIds.length > 0 ? flowIds : null,
        p_search: term || null,
        p_limit: EXPORT_BATCH,
        p_offset: offset,
      });
      if (error) throw error;
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      if (rows.length === 0) break;
      all.push(...rows.map((r) => r.contact));
      if (rows.length < EXPORT_BATCH) break;
      offset += EXPORT_BATCH;
    }
    return all;
  }

  let offset = 0;
  while (true) {
    let query = supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + EXPORT_BATCH - 1);

    if (term) {
      const like = `%${term}%`;
      query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < EXPORT_BATCH) break;
    offset += EXPORT_BATCH;
  }

  return all;
}

async function enrichWithTags(
  supabase: SupabaseClient,
  contacts: Contact[],
  tagsMap: Record<string, Tag>,
): Promise<ContactWithTags[]> {
  if (contacts.length === 0) return [];

  const tagsByContact: Record<string, Tag[]> = {};
  const ids = contacts.map((c) => c.id);

  for (let i = 0; i < ids.length; i += EXPORT_BATCH) {
    const chunk = ids.slice(i, i + EXPORT_BATCH);
    const { data, error } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', chunk);
    if (error) throw error;

    data?.forEach((ct) => {
      const tag = tagsMap[ct.tag_id];
      if (!tag) return;
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(tag);
    });
  }

  return contacts.map((c) => ({
    ...c,
    tags: tagsByContact[c.id] ?? [],
  }));
}

function contactsToCsvRows(contacts: ContactWithTags[]): string[][] {
  const header = ['phone', 'name', 'email', 'company', 'tags'];
  const rows = contacts.map((c) => [
    c.phone,
    c.name ?? '',
    c.email ?? '',
    c.company ?? '',
    (c.tags ?? []).map((t) => t.name).join(', '),
  ]);
  return [header, ...rows];
}

export async function exportContactsCsv(
  supabase: SupabaseClient,
  opts: {
    search: string;
    tagIds: string[];
    flowIds?: string[];
    tagsMap: Record<string, Tag>;
  },
): Promise<number> {
  const contacts = await fetchAllFilteredContacts(
    supabase,
    opts.search,
    opts.tagIds,
    opts.flowIds ?? [],
  );
  const enriched = await enrichWithTags(supabase, contacts, opts.tagsMap);
  const csv = toCsv(contactsToCsvRows(enriched));
  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`contacts-export-${date}.csv`, csv);
  return enriched.length;
}
