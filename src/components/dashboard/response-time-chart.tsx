"use client"

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'
import { formatChartDayShort } from '@/lib/dashboard/date-utils'

export type ResponseTimeRangeDays = 1 | 7 | 30

const RANGE_OPTIONS: { value: ResponseTimeRangeDays; label: string }[] = [
  { value: 1, label: 'Today' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
]

interface ResponseTimeChartProps {
  /** Per-range data so switching tabs never re-fetches. */
  series: Record<ResponseTimeRangeDays, ResponseTimeSummary | null>
  loading: boolean
  range: ResponseTimeRangeDays
  onRangeChange: (r: ResponseTimeRangeDays) => void
  thresholdMinutes?: number
}

const VB_W = 760
const VB_H = 220
const CHART_HEIGHT = 'h-[240px]'
const PADDING = { top: 16, right: 16, bottom: 28, left: 44 }

/** Light-card bar palette — rose/pink, distinct from conversations dark area chart. */
const BAR_ON_TARGET = '#FDA4AF'
const BAR_OVER_TARGET = '#F87171'
const GRID_STROKE = '#E5E7EB'
const AXIS_LABEL = '#9CA3AF'

export function ResponseTimeChart({
  series,
  loading,
  range,
  onRangeChange,
  thresholdMinutes = 5,
}: ResponseTimeChartProps) {
  const data = series[range]
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Average First Response Time
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Minutes to reply to a customer&apos;s first unreplied message, by day
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {RANGE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onRangeChange(value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  range === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {thresholdMinutes > 0 && (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600 tabular-nums">
              target {thresholdMinutes}m
            </span>
          )}
          {data && (data.thisWeekAvg != null || data.lastWeekAvg != null) && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">
                This week:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {fmt(data.thisWeekAvg)}
                </span>
              </div>
              <div className="text-muted-foreground">
                Last week:{' '}
                <span className="tabular-nums">{fmt(data.lastWeekAvg)}</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-col p-5">
        {loading || !data ? (
          <Skeleton className={cn('w-full rounded-lg', CHART_HEIGHT)} />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title="No replies recorded yet"
            hint="This chart fills in as you reply to customer messages."
            className={CHART_HEIGHT}
          />
        ) : (
          <BarSvg
            buckets={data.buckets}
            thresholdMinutes={thresholdMinutes}
          />
        )}
      </div>
    </section>
  )
}

function BarSvg({
  buckets,
  thresholdMinutes,
}: {
  buckets: ResponseTimeSummary['buckets']
  thresholdMinutes: number
}) {
  const { maxY, niceTicks } = useMemo(() => {
    const values = buckets
      .map((b) => b.avgMinutes)
      .filter((v): v is number => v != null)
    const peak = values.reduce(
      (m, v) => Math.max(m, v, thresholdMinutes),
      thresholdMinutes,
    )
    const ceil = niceCeil(peak)
    const ticks = [0, ceil / 4, ceil / 2, (3 * ceil) / 4, ceil].map((v) =>
      Math.round(v * 10) / 10,
    )
    return { maxY: ceil, niceTicks: Array.from(new Set(ticks)) }
  }, [buckets, thresholdMinutes])

  const chartW = VB_W - PADDING.left - PADDING.right
  const chartH = VB_H - PADDING.top - PADDING.bottom
  const slotW = chartW / buckets.length
  const barW = Math.min(24, slotW * 0.5)
  const yFor = (minutes: number) =>
    PADDING.top + chartH - (minutes / maxY) * chartH
  const baselineY = PADDING.top + chartH
  const targetY = yFor(thresholdMinutes)
  const barRadius = Math.min(6, barW / 2)

  const labelStride = Math.max(1, Math.ceil(buckets.length / 6))

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-border/60 bg-background',
        CHART_HEIGHT,
      )}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-full w-full"
        role="img"
        aria-label="Average first response time per day"
      >
        {/* Y-axis + baseline */}
        <line
          x1={PADDING.left}
          x2={PADDING.left}
          y1={PADDING.top}
          y2={baselineY}
          stroke={GRID_STROKE}
          strokeWidth={1}
        />
        <line
          x1={PADDING.left}
          x2={VB_W - PADDING.right}
          y1={baselineY}
          y2={baselineY}
          stroke={GRID_STROKE}
          strokeWidth={1}
        />

        {/* Dotted horizontal gridlines + Y labels */}
        {niceTicks.map((t) => {
          const y = yFor(t)
          return (
            <g key={t}>
              <line
                x1={PADDING.left}
                x2={VB_W - PADDING.right}
                y1={y}
                y2={y}
                stroke={GRID_STROKE}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill={AXIS_LABEL}
                fontSize={10}
              >
                {formatTick(t)}
              </text>
            </g>
          )
        })}

        {/* Target reference line */}
        {thresholdMinutes > 0 && thresholdMinutes <= maxY && (
          <line
            x1={PADDING.left}
            x2={VB_W - PADDING.right}
            y1={targetY}
            y2={targetY}
            stroke="#FB7185"
            strokeDasharray="5 4"
            strokeWidth={1}
            opacity={0.55}
          />
        )}

        {/* Rounded-top bars */}
        {buckets.map((bucket, i) => {
          const actual = bucket.avgMinutes
          if (actual == null || bucket.samples === 0) return null

          const x = PADDING.left + i * slotW + (slotW - barW) / 2
          const barH = (actual / maxY) * chartH
          const barY = baselineY - barH
          const overTarget = actual > thresholdMinutes
          const fill = overTarget ? BAR_OVER_TARGET : BAR_ON_TARGET

          return (
            <path
              key={bucket.day}
              d={roundedTopRectPath(x, barY, barW, barH, barRadius)}
              fill={fill}
            />
          )
        })}

        {/* X-axis labels */}
        {buckets.map((bucket, i) =>
          i % labelStride === 0 ? (
            <text
              key={bucket.day}
              x={PADDING.left + i * slotW + slotW / 2}
              y={VB_H - 8}
              textAnchor="middle"
              fill={AXIS_LABEL}
              fontSize={10}
            >
              {shortDayLabel(bucket.day)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  )
}

/** Rounded rectangle with only the top corners curved. */
function roundedTopRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
): string {
  const r = Math.min(rx, width / 2, height)
  if (r <= 0) {
    return `M${x},${y + height} L${x},${y} L${x + width},${y} L${x + width},${y + height} Z`
  }
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    'Z',
  ].join(' ')
}

function shortDayLabel(key: string): string {
  return formatChartDayShort(key)
}

function formatTick(value: number): string {
  if (value === 0) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  return `${(mins / 60).toFixed(1)}h`
}

function niceCeil(max: number): number {
  if (max <= 0) return 10
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const normalised = max / pow
  let nice: number
  if (normalised <= 1) nice = 1
  else if (normalised <= 2) nice = 2
  else if (normalised <= 5) nice = 5
  else nice = 10
  return nice * pow
}
