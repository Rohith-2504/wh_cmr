"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import type { ConversationsSeriesPoint } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'
import { formatChartDayLong, formatChartDayShort } from '@/lib/dashboard/date-utils'

type RangeDays = 7 | 30 | 90

interface ConversationsChartProps {
  /** Per-range data, so switching tabs never re-fetches. */
  series: Record<RangeDays, ConversationsSeriesPoint[] | null>
  loading: boolean
  range: RangeDays
  onRangeChange: (r: RangeDays) => void
}

const VB_W = 760
const VB_H = 280
const PADDING = { top: 36, right: 20, bottom: 32, left: 44 }

/** Reference palette — blue + amber area chart (uploaded design). */
const INCOMING = { line: '#4F8EF7', fill: '#4F8EF7' }
const OUTGOING = { line: '#F5A623', fill: '#F5A623' }

export function ConversationsChart({ series, loading, range, onRangeChange }: ConversationsChartProps) {
  const data = series[range]

  const { maxY, niceTicks } = useMemo(() => {
    const arr = data ?? []
    const max = arr.reduce(
      (m, p) => Math.max(m, p.incoming, p.outgoing),
      0,
    )
    const ceil = niceCeil(max)
    const ticks = [0, ceil / 4, ceil / 2, (3 * ceil) / 4, ceil].map((v) =>
      Math.round(v),
    )
    return { maxY: ceil, niceTicks: Array.from(new Set(ticks)) }
  }, [data])

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Conversations Over Time</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Daily message volume by direction</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
          {[7, 30, 90].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRangeChange(r as RangeDays)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === r
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r} days
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {loading || !data ? (
          <Skeleton className="flex-1 w-full rounded-xl" />
        ) : data.every((p) => p.incoming === 0 && p.outgoing === 0) ? (
          <EmptyState
            icon={MessageSquare}
            title="No message activity in this range"
            hint="Send or receive messages to start populating this chart."
          />
        ) : (
          <AreaChartSvg data={data} maxY={maxY} ticks={niceTicks} />
        )}
      </div>
    </section>
  )
}

function AreaChartSvg({
  data,
  maxY,
  ticks,
}: {
  data: ConversationsSeriesPoint[]
  maxY: number
  ticks: number[]
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const chartW = VB_W - PADDING.left - PADDING.right
  const chartH = VB_H - PADDING.top - PADDING.bottom
  const baselineY = PADDING.top + chartH

  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0
  const yFor = (v: number) =>
    maxY === 0 ? baselineY : PADDING.top + chartH - (v / maxY) * chartH
  const xFor = (i: number) => PADDING.left + i * stepX

  const incomingPoints = useMemo(
    () => data.map((p, i) => ({ x: xFor(i), y: yFor(p.incoming) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, maxY, stepX],
  )
  const outgoingPoints = useMemo(
    () => data.map((p, i) => ({ x: xFor(i), y: yFor(p.outgoing) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, maxY, stepX],
  )

  const incomingLine = buildSmoothPath(incomingPoints)
  const outgoingLine = buildSmoothPath(outgoingPoints)
  const incomingArea = buildAreaPath(incomingLine, incomingPoints, baselineY)
  const outgoingArea = buildAreaPath(outgoingLine, outgoingPoints, baselineY)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onMove = (e: MouseEvent) => {
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const local = pt.matrixTransform(ctm.inverse())
      const xVb = local.x
      if (xVb < PADDING.left - 8 || xVb > VB_W - PADDING.right + 8) {
        setHoverIdx(null)
        return
      }
      const relative = xVb - PADDING.left
      const idx = Math.max(
        0,
        Math.min(data.length - 1, Math.round(stepX === 0 ? 0 : relative / stepX)),
      )
      setHoverIdx(idx)
    }
    const onLeave = () => setHoverIdx(null)
    svg.addEventListener('mousemove', onMove)
    svg.addEventListener('mouseleave', onLeave)
    return () => {
      svg.removeEventListener('mousemove', onMove)
      svg.removeEventListener('mouseleave', onLeave)
    }
  }, [data, stepX])

  const hovered = hoverIdx !== null ? data[hoverIdx] : null
  const hoverX = hoverIdx !== null ? xFor(hoverIdx) : 0
  const labelStride = Math.max(1, Math.ceil(data.length / 6))

  return (
    <div className="relative flex min-h-0 flex-1 w-full overflow-hidden rounded-xl bg-[#121820]">
      {/* In-chart legend — top left (reference design) */}
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-4 text-[11px] text-[#9CA3AF]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: INCOMING.line }} />
          Incoming
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: OUTGOING.line }} />
          Outgoing
        </span>
      </div>

      {/* Hover summary — top right (reference design) */}
      {hovered && hoverIdx !== null && (
        <div className="pointer-events-none absolute right-4 top-3 z-10 text-right">
          <p className="text-[10px] text-[#6B7280]">{longDayLabel(hovered.day)}</p>
          <p className="text-lg font-semibold leading-tight" style={{ color: INCOMING.line }}>
            {hovered.incoming.toLocaleString()}
            <span className="ml-1 text-[11px] font-normal text-[#9CA3AF]">incoming</span>
          </p>
          <p className="text-lg font-semibold leading-tight" style={{ color: OUTGOING.line }}>
            {hovered.outgoing.toLocaleString()}
            <span className="ml-1 text-[11px] font-normal text-[#9CA3AF]">outgoing</span>
          </p>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-full min-h-[200px] w-full"
        role="img"
        aria-label="Conversations per day"
      >
        <defs>
          <linearGradient id="incomingAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INCOMING.fill} stopOpacity="0.45" />
            <stop offset="100%" stopColor={INCOMING.fill} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="outgoingAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={OUTGOING.fill} stopOpacity="0.35" />
            <stop offset="100%" stopColor={OUTGOING.fill} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Subtle horizontal guides */}
        {ticks.map((t) => {
          const y = yFor(t)
          return (
            <g key={t}>
              <line
                x1={PADDING.left}
                x2={VB_W - PADDING.right}
                y1={y}
                y2={y}
                stroke="#2A3441"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 10}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#6B7280"
                fontSize={10}
              >
                {t}
              </text>
            </g>
          )
        })}

        {/* Area fills — draw outgoing first so incoming stacks on top when overlapping */}
        <path d={outgoingArea} fill="url(#outgoingAreaGrad)" />
        <path d={incomingArea} fill="url(#incomingAreaGrad)" />

        {/* Smooth lines */}
        <path
          d={outgoingLine}
          fill="none"
          stroke={OUTGOING.line}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={incomingLine}
          fill="none"
          stroke={INCOMING.line}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* X-axis labels */}
        {data.map((p, i) =>
          i % labelStride === 0 ? (
            <text
              key={p.day}
              x={xFor(i)}
              y={VB_H - 10}
              textAnchor="middle"
              fill="#6B7280"
              fontSize={10}
            >
              {shortDayLabel(p.day)}
            </text>
          ) : null,
        )}

        {/* Hover indicator */}
        {hoverIdx !== null && (
          <g pointerEvents="none">
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PADDING.top}
              y2={baselineY}
              stroke={INCOMING.line}
              strokeWidth={1.5}
              opacity={0.85}
            />
            <circle
              cx={hoverX}
              cy={yFor(data[hoverIdx].incoming)}
              r={5}
              fill="#fff"
              stroke={INCOMING.line}
              strokeWidth={2}
            />
            <circle
              cx={hoverX}
              cy={yFor(data[hoverIdx].outgoing)}
              r={5}
              fill="#fff"
              stroke={OUTGOING.line}
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
    </div>
  )
}

/** Monotone cubic spline through points (smooth area-chart curves). */
function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`

  let d = `M ${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

function buildAreaPath(
  linePath: string,
  points: Array<{ x: number; y: number }>,
  baselineY: number,
): string {
  if (!linePath || points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${linePath} L ${last.x},${baselineY} L ${first.x},${baselineY} Z`
}

function shortDayLabel(key: string): string {
  return formatChartDayShort(key)
}

function longDayLabel(key: string): string {
  return formatChartDayLong(key)
}

function niceCeil(max: number): number {
  if (max <= 0) return 4
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const normalised = max / pow
  let nice: number
  if (normalised <= 1) nice = 1
  else if (normalised <= 2) nice = 2
  else if (normalised <= 5) nice = 5
  else nice = 10
  return nice * pow
}
