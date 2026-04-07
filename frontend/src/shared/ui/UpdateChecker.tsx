/**
 * UpdateNotification — Sidebar widget showing when a new version is available.
 *
 * Polls the GitHub Releases API for the upstream repository and shows a
 * compact card in the sidebar when the latest tag is newer than the
 * currently running version. The card surfaces grouped highlights and a
 * one-click jump to either the full in-app changelog or the GitHub release.
 *
 * Implementation notes:
 *
 * - **Caching.** The GitHub response is cached in localStorage with a 1-hour
 *   TTL keyed by URL. Multiple tabs / sessions reuse the cached payload so
 *   we don't hammer the unauthenticated GitHub API (which is rate-limited
 *   to 60 req/hour per IP).
 *
 * - **First check.** Runs ~2 seconds after mount so the user sees the card
 *   almost immediately on a fresh load if there is an update. Subsequent
 *   checks happen every hour.
 *
 * - **Dismiss.** Per-version dismiss state is stored in localStorage; once
 *   the user closes the card for v0.8.0 they will not see it again until
 *   v0.8.1 (or higher) appears.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, X, ExternalLink, ChevronDown, ChevronUp, BookOpen, Plus, Wrench, Palette,
} from 'lucide-react';
import { APP_VERSION } from '@/shared/lib/version';

const CURRENT_VERSION = APP_VERSION;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;       // 1 hour between polls
const FIRST_CHECK_DELAY_MS = 2_000;             // first check ~2s after mount
const CACHE_TTL_MS = 60 * 60 * 1000;            // 1 hour
const CACHE_KEY = 'oe_update_cache_v1';
const DISMISS_KEY = 'oe_update_dismissed_version';

const GITHUB_RELEASES_API =
  'https://api.github.com/repos/datadrivenconstruction/OpenConstructionERP/releases/latest';

interface ReleaseInfo {
  version: string;
  notes: string;
  url: string;
  publishedAt: string;
}

interface CachedRelease {
  fetched_at: number;
  data: ReleaseInfo;
}

interface GroupedHighlights {
  added: string[];
  fixed: string[];
  polished: string[];
  other: string[];
  totalCount: number;
}

/** Compare semver strings — returns true if `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Parse markdown release notes into grouped highlights.
 *
 * We classify each bullet by its leading prefix (New:/Fix:/Polish:/etc.)
 * which is the convention used by our own changelog. Lines that don't
 * match any prefix go into the "other" bucket. The total count includes
 * everything regardless of length filtering so the badge stays accurate.
 */
function groupHighlights(notes: string): GroupedHighlights {
  const lines = notes
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l.length > 5 && l.length < 240);

  const result: GroupedHighlights = {
    added: [],
    fixed: [],
    polished: [],
    other: [],
    totalCount: lines.length,
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('new:') || lower.startsWith('add')) {
      result.added.push(line.replace(/^(new|add(?:ed)?):\s*/i, ''));
    } else if (lower.startsWith('fix')) {
      result.fixed.push(line.replace(/^fix(?:ed)?:?\s*/i, ''));
    } else if (lower.startsWith('polish') || lower.startsWith('improve')) {
      result.polished.push(line.replace(/^(polish|improve(?:d)?):?\s*/i, ''));
    } else {
      result.other.push(line);
    }
  }

  return result;
}

/* ── Cache helpers ─────────────────────────────────────────────────── */

function readCache(): CachedRelease | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedRelease;
    if (!cached?.fetched_at || !cached?.data) return null;
    if (Date.now() - cached.fetched_at > CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCache(data: ReleaseInfo): void {
  try {
    const payload: CachedRelease = { fetched_at: Date.now(), data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage quota or disabled — silent */
  }
}

/* ── Component ─────────────────────────────────────────────────────── */

export function UpdateNotification() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const checkForUpdate = useCallback(async () => {
    // 1. Try cache first — avoids hitting GitHub API when multiple tabs are open.
    const cached = readCache();
    if (cached) {
      const dismissedVersion = localStorage.getItem(DISMISS_KEY);
      if (dismissedVersion !== cached.data.version && isNewer(cached.data.version, CURRENT_VERSION)) {
        setRelease(cached.data);
      }
      return;
    }

    // 2. Cache miss → fetch from GitHub.
    try {
      const resp = await fetch(GITHUB_RELEASES_API);
      if (!resp.ok) return;
      const data = await resp.json();
      const latest = (data.tag_name ?? '').replace(/^v/, '');
      if (!latest) return;

      const info: ReleaseInfo = {
        version: latest,
        notes: data.body ?? '',
        url:
          data.html_url ??
          'https://github.com/datadrivenconstruction/OpenConstructionERP/releases',
        publishedAt: data.published_at ?? '',
      };
      writeCache(info);

      if (!isNewer(latest, CURRENT_VERSION)) return;

      const dismissedVersion = localStorage.getItem(DISMISS_KEY);
      if (dismissedVersion === latest) return;

      setRelease(info);
    } catch {
      /* Network error — silent. The next polling tick will retry. */
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(checkForUpdate, FIRST_CHECK_DELAY_MS);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (release) {
      localStorage.setItem(DISMISS_KEY, release.version);
    }
  }, [release]);

  const grouped = useMemo<GroupedHighlights | null>(
    () => (release ? groupHighlights(release.notes) : null),
    [release],
  );

  if (!release || dismissed) return null;

  const relativeDate = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString()
    : '';

  // Show up to 3 entries per category in the collapsed preview to keep
  // the card from dominating the sidebar. The user can click "View
  // in-app changelog" for the full list.
  const previewLimit = 3;

  return (
    <div className="mx-2 mb-2 rounded-xl border border-emerald-300/60 dark:border-emerald-700/40 bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-cyan-950/20 overflow-hidden animate-card-in shadow-sm shadow-emerald-500/5">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Icon with attention-grabbing pulse */}
        <div className="relative shrink-0">
          <span
            className="absolute inset-0 rounded-lg bg-emerald-500/20 animate-ping"
            aria-hidden="true"
          />
          <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
            <Sparkles size={15} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">
              v{release.version}
            </span>
            <span className="text-2xs font-medium uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/60">
              {t('update.new_available', { defaultValue: 'available' })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-2xs text-emerald-700/60 dark:text-emerald-300/50">
            {relativeDate && <span>{relativeDate}</span>}
            {grouped && grouped.totalCount > 0 && (
              <>
                {relativeDate && <span aria-hidden="true">·</span>}
                <span className="tabular-nums">
                  {t('update.changes_count', {
                    defaultValue: '{{count}} changes',
                    count: grouped.totalCount,
                  })}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={handleDismiss}
          aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
          className="flex h-6 w-6 items-center justify-center rounded-md text-emerald-500/60 hover:text-emerald-700 hover:bg-emerald-500/10 dark:hover:bg-emerald-400/10 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* ── Highlights (collapsible, grouped by type) ───────────── */}
      {grouped && grouped.totalCount > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between gap-1.5 px-3 py-1.5 text-2xs font-medium text-emerald-700/80 dark:text-emerald-300/70 hover:text-emerald-800 dark:hover:text-emerald-200 hover:bg-emerald-500/[0.04] transition-colors border-t border-emerald-200/40 dark:border-emerald-800/30"
            aria-expanded={expanded}
          >
            <span>{t('update.whats_new', { defaultValue: "What's new" })}</span>
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {expanded && (
            <div className="px-3 py-2 space-y-2 border-t border-emerald-200/40 dark:border-emerald-800/30">
              {grouped.added.length > 0 && (
                <HighlightGroup
                  icon={<Plus size={9} />}
                  iconClass="text-emerald-600 dark:text-emerald-400 bg-emerald-500/15"
                  label={t('update.group_new', { defaultValue: 'New' })}
                  items={grouped.added.slice(0, previewLimit)}
                  hiddenCount={Math.max(0, grouped.added.length - previewLimit)}
                />
              )}
              {grouped.fixed.length > 0 && (
                <HighlightGroup
                  icon={<Wrench size={9} />}
                  iconClass="text-blue-600 dark:text-blue-400 bg-blue-500/15"
                  label={t('update.group_fixed', { defaultValue: 'Fixed' })}
                  items={grouped.fixed.slice(0, previewLimit)}
                  hiddenCount={Math.max(0, grouped.fixed.length - previewLimit)}
                />
              )}
              {grouped.polished.length > 0 && (
                <HighlightGroup
                  icon={<Palette size={9} />}
                  iconClass="text-violet-600 dark:text-violet-400 bg-violet-500/15"
                  label={t('update.group_polished', { defaultValue: 'Polished' })}
                  items={grouped.polished.slice(0, previewLimit)}
                  hiddenCount={Math.max(0, grouped.polished.length - previewLimit)}
                />
              )}
              {grouped.other.length > 0 && grouped.added.length + grouped.fixed.length + grouped.polished.length === 0 && (
                <ul className="space-y-1">
                  {grouped.other.slice(0, 5).map((line, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-2xs text-emerald-700/80 dark:text-emerald-300/70">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-500/60" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Action buttons ──────────────────────────────────────── */}
      <div className="flex gap-1.5 px-3 pb-2.5 pt-1">
        <button
          onClick={() => {
            navigate('/about');
            // Defer the scroll until the route has actually rendered
            setTimeout(() => {
              const el = document.getElementById('changelog');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 80);
          }}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300/70 dark:border-emerald-700/50 bg-white/50 dark:bg-emerald-950/30 hover:bg-white dark:hover:bg-emerald-950/50 px-2.5 py-1.5 text-2xs font-semibold text-emerald-700 dark:text-emerald-200 transition-colors"
        >
          <BookOpen size={11} />
          {t('update.in_app_changelog', { defaultValue: 'Changelog' })}
        </button>
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 px-2.5 py-1.5 text-2xs font-semibold text-white shadow-sm shadow-emerald-500/20 transition-all hover:shadow-emerald-500/30"
        >
          {t('update.view_release', { defaultValue: 'Release' })}
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

/* ── Subcomponent: one labelled group of highlights ──────────────── */

function HighlightGroup({
  icon,
  iconClass,
  label,
  items,
  hiddenCount,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  items: string[];
  hiddenCount: number;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded ${iconClass}`}>
          {icon}
        </span>
        <span className="text-2xs font-semibold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/60">
          {label}
        </span>
      </div>
      <ul className="space-y-0.5 ml-5">
        {items.map((line, i) => (
          <li
            key={i}
            className="text-2xs leading-snug text-emerald-800/85 dark:text-emerald-200/80 line-clamp-2"
          >
            {line}
          </li>
        ))}
        {hiddenCount > 0 && (
          <li className="text-2xs italic text-emerald-600/60 dark:text-emerald-400/50">
            {t('update.more_count', {
              defaultValue: '+ {{count}} more',
              count: hiddenCount,
            })}
          </li>
        )}
      </ul>
    </div>
  );
}
