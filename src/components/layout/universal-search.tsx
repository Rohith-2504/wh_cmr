"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  runUniversalSearch,
  SEARCH_GROUP_LABELS,
  SEARCH_GROUP_ORDER,
  type UniversalSearchResult,
  type UniversalSearchResultType,
} from "@/lib/search/universal-search";
import {
  Search,
  Loader2,
  Users,
  MessageSquare,
  Tag,
  Radio,
  Zap,
  Workflow,
  Briefcase,
  Kanban,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<
  UniversalSearchResultType,
  ComponentType<{ className?: string }>
> = {
  contact: Users,
  conversation: MessageSquare,
  message: MessageSquare,
  tag: Tag,
  broadcast: Radio,
  automation: Zap,
  flow: Workflow,
  deal: Briefcase,
  pipeline: Kanban,
};

interface UniversalSearchProps {
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}

export function UniversalSearch({ inputRef, className }: UniversalSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UniversalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const mergedRef = inputRef ?? localInputRef;
  const searchSeq = useRef(0);

  const grouped = useMemo(() => {
    const map = new Map<UniversalSearchResultType, UniversalSearchResult[]>();
    for (const result of results) {
      const list = map.get(result.type) ?? [];
      list.push(result);
      map.set(result.type, list);
    }
    return SEARCH_GROUP_ORDER.filter((type) => map.has(type)).map((type) => ({
      type,
      label: SEARCH_GROUP_LABELS[type],
      items: map.get(type)!,
    }));
  }, [results]);

  const flatResults = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped],
  );

  const runSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const supabase = createClient();
      const data = await runUniversalSearch(supabase, trimmed);
      if (seq !== searchSeq.current) return;
      setResults(data);
      setActiveIndex(data.length > 0 ? 0 : -1);
    } catch {
      if (seq !== searchSeq.current) return;
      setResults([]);
      setActiveIndex(-1);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void runSearch(query);
    }, 280);
    return () => window.clearTimeout(handle);
  }, [query, open, runSearch]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const navigateTo = useCallback(
    (result: UniversalSearchResult) => {
      setOpen(false);
      setQuery("");
      setResults([]);
      router.push(result.href);
    },
    [router],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      mergedRef.current?.blur();
      return;
    }

    if (!open || flatResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flatResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        i <= 0 ? flatResults.length - 1 : i - 1,
      );
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      navigateTo(flatResults[activeIndex]);
    }
  };

  let flatOffset = 0;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3.5 py-1.5 text-muted-foreground transition-all hover:bg-muted/65",
          open && "border-primary/50 ring-2 ring-primary/10 bg-muted/65",
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={mergedRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search contacts, chats, flows…"
          aria-label="Universal search"
          aria-expanded={open}
          aria-controls="universal-search-results"
          role="combobox"
          autoComplete="off"
          className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border bg-card px-1.5 font-mono text-[9px] font-medium text-muted-foreground shadow-sm sm:inline-flex">
            <span>⌘</span>K
          </kbd>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div
          id="universal-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(420px,70vh)] overflow-y-auto rounded-2xl border border-border/60 bg-popover p-1 shadow-xl"
        >
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No results for &ldquo;{query.trim()}&rdquo;
            </div>
          ) : (
            grouped.map((group) => {
              const groupStart = flatOffset;
              flatOffset += group.items.length;
              return (
                <div key={group.type} className="py-1">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                  <ul>
                    {group.items.map((result, idx) => {
                      const flatIdx = groupStart + idx;
                      const Icon = TYPE_ICONS[result.type];
                      const active = flatIdx === activeIndex;
                      return (
                        <li key={`${result.type}-${result.id}`}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setActiveIndex(flatIdx)}
                            onClick={() => navigateTo(result)}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                              active
                                ? "bg-muted"
                                : "hover:bg-muted/70",
                            )}
                          >
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-foreground">
                                {result.title}
                              </p>
                              {result.subtitle && (
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {result.subtitle}
                                </p>
                              )}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
