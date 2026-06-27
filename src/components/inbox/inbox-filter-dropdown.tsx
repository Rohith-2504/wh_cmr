"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { ChevronDown, Tag as TagIcon, Zap } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Portaled popovers need `inbox-wa` on the panel for WA tokens + solid chrome. */
const INBOX_FILTER_POPOVER_CLASS =
  "inbox-wa wa-filter-popover ring-0 w-60 p-0";

/** Shared row hover — see `.inbox-wa .wa-filter-option:hover` in globals.css */
export const INBOX_FILTER_OPTION_CLASS =
  "wa-filter-option flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors";

interface FilterOption<T extends string> {
  label: string;
  value: T;
}

export interface InboxFilterTriggerProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "children"> {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  /** Hide chevron for icon-only triggers (e.g. ⋯ menu). */
  hideChevron?: boolean;
}

export const InboxFilterTrigger = forwardRef<
  HTMLButtonElement,
  InboxFilterTriggerProps
>(function InboxFilterTrigger(
  {
    icon,
    label,
    active,
    badge,
    hideChevron,
    className,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "wa-filter-trigger inline-flex h-8 items-center gap-1 rounded-lg border-0 px-2.5 text-[13px] outline-none focus:ring-1 focus:ring-[var(--wa-green)]/40",
        active
          ? "bg-[var(--wa-green)]/15 text-[var(--wa-text)]"
          : "bg-[var(--wa-search-bg)] text-[var(--wa-text)]",
        className,
      )}
      {...props}
    >
      <span className="shrink-0 wa-text-muted">{icon}</span>
      {label ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : null}
      {badge !== undefined && badge > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--wa-green)] px-1 text-[10px] font-semibold leading-none text-[#111b21]">
          {badge}
        </span>
      )}
      {!hideChevron && (
        <ChevronDown className="h-3 w-3 shrink-0 wa-text-muted" />
      )}
    </button>
  );
});

interface InboxFilterPanelHeaderProps {
  title: string;
  onClear?: () => void;
  showClear?: boolean;
}

export function InboxFilterPanelHeader({
  title,
  onClear,
  showClear,
}: InboxFilterPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--wa-border)] px-3 py-2">
      <span className="text-[13px] font-medium text-[var(--wa-text)]">
        {title}
      </span>
      {showClear && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] wa-text-muted transition-colors hover:text-[var(--wa-text)]"
        >
          Clear
        </button>
      )}
    </div>
  );
}

interface InboxSingleSelectFilterProps<T extends string> {
  ariaLabel: string;
  panelTitle: string;
  icon: ReactNode;
  defaultLabel: string;
  defaultValue: T;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  getOptionLabel?: (opt: FilterOption<T>) => string;
  getOptionClassName?: (opt: FilterOption<T>, selected: boolean) => string;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  /** Always show this on the trigger (e.g. current status name). */
  triggerLabelOverride?: string;
}

export function InboxSingleSelectFilter<T extends string>({
  ariaLabel,
  panelTitle,
  icon,
  defaultLabel,
  defaultValue,
  options,
  value,
  onChange,
  getOptionLabel,
  getOptionClassName,
  triggerClassName,
  align = "start",
  triggerLabelOverride,
}: InboxSingleSelectFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((opt) => opt.value === value);
  const isActive = value !== defaultValue;
  const triggerLabel =
    triggerLabelOverride ??
    (isActive && selected
      ? (getOptionLabel?.(selected) ?? selected.label)
      : defaultLabel);

  const handleSelect = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InboxFilterTrigger
            icon={icon}
            label={triggerLabel}
            active={isActive}
            aria-label={ariaLabel}
            className={triggerClassName}
          />
        }
      />
      <PopoverContent align={align} className={INBOX_FILTER_POPOVER_CLASS}>
        <InboxFilterPanelHeader title={panelTitle} />
        <div className="max-h-56 overflow-y-auto py-1">
          {options.map((opt) => {
            const optionLabel = getOptionLabel?.(opt) ?? opt.label;
            const checked = value === opt.value;
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-[var(--wa-hover-row)]"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => handleSelect(opt.value)}
                  aria-label={optionLabel}
                />
                <span
                  className={cn(
                    "truncate text-[13px]",
                    getOptionClassName?.(opt, checked) ??
                      "text-[var(--wa-text)]",
                  )}
                >
                  {optionLabel}
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface InboxActionMenuItem {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface InboxActionMenuProps {
  ariaLabel: string;
  panelTitle: string;
  triggerIcon: ReactNode;
  triggerLabel?: string;
  items: InboxActionMenuItem[];
  align?: "start" | "center" | "end";
  triggerClassName?: string;
}

/** Popover action list — same panel chrome as inbox filters (no glass morphism). */
export function InboxActionMenu({
  ariaLabel,
  panelTitle,
  triggerIcon,
  triggerLabel = "",
  items,
  align = "end",
  triggerClassName,
}: InboxActionMenuProps) {
  const [open, setOpen] = useState(false);

  const run = (item: InboxActionMenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onClick();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InboxFilterTrigger
            icon={triggerIcon}
            label={triggerLabel}
            hideChevron={!triggerLabel}
            aria-label={ariaLabel}
            className={triggerClassName}
          />
        }
      />
      <PopoverContent align={align} className={INBOX_FILTER_POPOVER_CLASS}>
        <InboxFilterPanelHeader title={panelTitle} />
        <div className="max-h-56 overflow-y-auto py-1">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => run(item)}
              className={cn(
                INBOX_FILTER_OPTION_CLASS,
                "w-full text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
                item.destructive ? "text-red-500" : "text-[var(--wa-text)]",
              )}
            >
              <span className="shrink-0 wa-text-muted">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface TagOption {
  id: string;
  name: string;
  color: string;
}

interface InboxTagFilterProps {
  tags: TagOption[];
  selectedTagIds: string[];
  onToggle: (tagId: string) => void;
  onClear: () => void;
  align?: "start" | "center" | "end";
}

interface AutomationOption {
  id: string;
  name: string;
}

interface InboxAutomationsFilterProps {
  automations: AutomationOption[];
  selectedAutomationIds: string[];
  onToggle: (automationId: string) => void;
  onClear: () => void;
  align?: "start" | "center" | "end";
}

export function InboxAutomationsFilter({
  automations,
  selectedAutomationIds,
  onToggle,
  onClear,
  align = "end",
}: InboxAutomationsFilterProps) {
  const [open, setOpen] = useState(false);
  const active = selectedAutomationIds.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InboxFilterTrigger
            icon={<Zap className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Automations"
            active={active}
            badge={active ? selectedAutomationIds.length : undefined}
            aria-label="Filter by automation"
            className="shrink-0"
          />
        }
      />
      <PopoverContent align={align} className={INBOX_FILTER_POPOVER_CLASS}>
        <InboxFilterPanelHeader
          title="Filter by automation"
          showClear={active}
          onClear={() => {
            onClear();
            setOpen(false);
          }}
        />
        {automations.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] wa-text-muted">
            No automations yet. Create automations in Automations.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto py-1">
            {automations.map((automation) => (
              <label
                key={automation.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-[var(--wa-hover-row)]"
              >
                <Checkbox
                  checked={selectedAutomationIds.includes(automation.id)}
                  onCheckedChange={() => onToggle(automation.id)}
                  aria-label={`Filter by ${automation.name}`}
                />
                <span className="truncate text-[13px] text-[var(--wa-text)]">
                  {automation.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function InboxTagFilter({
  tags,
  selectedTagIds,
  onToggle,
  onClear,
  align = "end",
}: InboxTagFilterProps) {
  const [open, setOpen] = useState(false);
  const active = selectedTagIds.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InboxFilterTrigger
            icon={<TagIcon className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Tags"
            active={active}
            badge={active ? selectedTagIds.length : undefined}
            aria-label="Filter by tags"
            className="shrink-0"
          />
        }
      />
      <PopoverContent align={align} className={INBOX_FILTER_POPOVER_CLASS}>
        <InboxFilterPanelHeader
          title="Filter by tags"
          showClear={active}
          onClear={() => {
            onClear();
            setOpen(false);
          }}
        />
        {tags.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] wa-text-muted">
            No tags yet. Create tags in Settings.
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto py-1">
            {tags.map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-[var(--wa-hover-row)]"
              >
                <Checkbox
                  checked={selectedTagIds.includes(tag.id)}
                  onCheckedChange={() => onToggle(tag.id)}
                  aria-label={`Filter by ${tag.name}`}
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="truncate text-[13px] text-[var(--wa-text)]">
                  {tag.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface AssignOption {
  userId: string;
  label: string;
  leading?: ReactNode;
  selected?: boolean;
}

interface InboxAssignFilterProps {
  assignLabel: string;
  options: AssignOption[];
  onSelect: (userId: string) => void;
  onUnassign?: () => void;
  align?: "start" | "center" | "end";
}

interface ContactTagAssignOption {
  id: string;
  name: string;
  color: string;
  selected?: boolean;
}

interface InboxContactTagAssignProps {
  tagLabel: string;
  options: ContactTagAssignOption[];
  onSelect: (tagId: string) => void;
  onUnassign?: () => void;
  disabled?: boolean;
  align?: "start" | "center" | "end";
}

/** Single-tag assign picker — same chrome as InboxAssignFilter. */
export function InboxContactTagAssign({
  tagLabel,
  options,
  onSelect,
  onUnassign,
  disabled,
  align = "end",
}: InboxContactTagAssignProps) {
  const [open, setOpen] = useState(false);
  const active = options.some((o) => o.selected);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <InboxFilterTrigger
            icon={<TagIcon className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label={tagLabel}
            active={active}
            aria-label="Assign tag"
            className="max-w-[7.5rem] sm:max-w-[9rem]"
          />
        }
      />
      <PopoverContent align={align} className={INBOX_FILTER_POPOVER_CLASS}>
        <InboxFilterPanelHeader title="Assign tag" />
        <div className="max-h-56 overflow-y-auto py-1">
          {options.length === 0 ? (
            <p className="px-3 py-4 text-center text-[13px] wa-text-muted">
              No tags yet. Create tags in Settings.
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--wa-hover-row)]",
                  opt.selected
                    ? "text-[var(--wa-green)]"
                    : "text-[var(--wa-text)]",
                )}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: opt.color }}
                />
                <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                {opt.selected && <CheckIcon />}
              </button>
            ))
          )}
          {onUnassign && active && (
            <>
              <div className="my-1 border-t border-[var(--wa-border)]" />
              <button
                type="button"
                onClick={() => {
                  onUnassign();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] wa-text-muted transition-colors hover:bg-[var(--wa-hover-row)]"
              >
                Remove tag
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function InboxAssignFilter({
  assignLabel,
  options,
  onSelect,
  onUnassign,
  align = "end",
}: InboxAssignFilterProps) {
  const [open, setOpen] = useState(false);
  const active = options.some((o) => o.selected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InboxFilterTrigger
            icon={<UserPlusIcon />}
            label={assignLabel}
            active={active}
            aria-label="Assign conversation"
            className="max-w-[7.5rem] sm:max-w-[9rem]"
          />
        }
      />
      <PopoverContent align={align} className={INBOX_FILTER_POPOVER_CLASS}>
        <InboxFilterPanelHeader title="Assign to" />
        <div className="max-h-56 overflow-y-auto py-1">
          {options.length === 0 ? (
            <p className="px-3 py-4 text-center text-[13px] wa-text-muted">
              No teammates available
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.userId}
                type="button"
                onClick={() => {
                  onSelect(opt.userId);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--wa-hover-row)]",
                  opt.selected
                    ? "text-[var(--wa-green)]"
                    : "text-[var(--wa-text)]",
                )}
              >
                {opt.leading}
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {opt.selected && <CheckIcon />}
              </button>
            ))
          )}
          {onUnassign && active && (
            <>
              <div className="my-1 border-t border-[var(--wa-border)]" />
              <button
                type="button"
                onClick={() => {
                  onUnassign();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] wa-text-muted transition-colors hover:bg-[var(--wa-hover-row)]"
              >
                Unassign
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserPlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" />
      <line x1="22" x2="16" y1="11" y2="11" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
