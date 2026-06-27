-- ============================================================
-- 027_filter_contacts.sql — unified tag + flow contact filter
--
-- Extends 025_filter_contacts_by_tags with optional flow
-- participation filter (flow_runs.contact_id). Both filters
-- are optional and combine with AND when both are set; each
-- array uses OR within itself (ANY matching tag / flow).
--
-- filter_contacts_by_tags is kept for backward compatibility.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts(
  p_tag_ids UUID[] DEFAULT NULL,
  p_flow_ids UUID[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    WHERE (
      p_search IS NULL
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR c.email ILIKE '%' || p_search || '%'
    )
    AND (
      p_tag_ids IS NULL
      OR cardinality(p_tag_ids) = 0
      OR EXISTS (
        SELECT 1 FROM contact_tags ct
        WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids)
      )
    )
    AND (
      p_flow_ids IS NULL
      OR cardinality(p_flow_ids) = 0
      OR EXISTS (
        SELECT 1 FROM flow_runs fr
        WHERE fr.contact_id = c.id AND fr.flow_id = ANY(p_flow_ids)
      )
    )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts(UUID[], UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(UUID[], UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(UUID[], UUID[], TEXT, INT, INT) TO authenticated;
