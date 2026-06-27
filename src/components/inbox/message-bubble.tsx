"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
} from "lucide-react";
import { formatTime } from "@/lib/dashboard/date-utils";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-[14px] w-[14px] wa-text-muted" />;
    case "sent":
      return <Check className="h-[14px] w-[14px] wa-text-muted" />;
    case "delivered":
      return <CheckCheck className="h-[14px] w-[14px] wa-text-muted" />;
    case "read":
      return <CheckCheck className="wa-read-tick h-[14px] w-[14px]" />;
    case "failed":
      return <XCircle className="h-[14px] w-[14px] text-red-500" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs wa-text-muted">
      <ImageOff className="h-4 w-4 shrink-0" />
      <span>{label} unavailable</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadImage = useCallback(async () => {
    if (!url) return;

    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-black/5">
        <ImageOff className="h-8 w-8 wa-text-muted" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-black/5">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--wa-green)] border-t-transparent" />
      </div>
    );
  }

  return (
    <Image
      src={src ?? ""}
      alt={alt}
      width={240}
      height={256}
      unoptimized
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

function MessageContent({ message }: { message: Message }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm hover:bg-black/10"
        >
          <FileText className="h-5 w-5 shrink-0 wa-text-muted" />
          <span className="truncate">
            {message.content_text || "Document"}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-[var(--wa-green)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--wa-green)]">
            <LayoutTemplate className="h-3 w-3" />
            Template
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 wa-text-muted" />
          <span>{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive":
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide wa-text-muted">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
            {message.content_text || "[Interactive reply]"}
          </p>
        </div>
      );

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-[14.2px] leading-[19px]">
          {message.content_text || "[Unsupported message type]"}
        </p>
      );
  }
}

/** Small SVG tail matching WhatsApp bubble corners. */
function BubbleTail({ outgoing }: { outgoing: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute bottom-0 h-[13px] w-[8px]",
        outgoing ? "-right-[8px]" : "-left-[8px]",
      )}
    >
      <svg
        viewBox="0 0 8 13"
        width="8"
        height="13"
        className={cn(outgoing && "scale-x-[-1]")}
      >
        <path
          d="M5.188 0H0v11.193l6.467-8.625C7.526 1.156 6.958 0 5.188 0z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = formatTime(message.created_at);

  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative max-w-full overflow-hidden px-[9px] py-[6px] ps-[9px] pe-[7px]",
          isAgent
            ? "wa-bubble-out rounded-[7.5px] rounded-tr-none"
            : "wa-bubble-in rounded-[7.5px] rounded-tl-none",
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute bottom-0",
            isAgent
              ? "-right-[8px] text-[var(--wa-bubble-out)]"
              : "-left-[8px] text-[var(--wa-bubble-in)]",
          )}
        >
          <BubbleTail outgoing={isAgent} />
        </span>
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "float-right ml-3 mt-1 flex items-center gap-0.5",
            isAgent ? "relative -bottom-0.5" : "",
          )}
        >
          <span className="text-[11px] leading-none wa-text-muted">{time}</span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
