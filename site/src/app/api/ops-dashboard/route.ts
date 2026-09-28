import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";
import {
  normalizeStage,
  type Clip,
  type ClipStatus,
  type Deal,
  type OpsDashboardState,
} from "@/lib/ops-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawDeal = {
  id?: string;
  brand?: string;
  category?: string;
  website?: string;
  contact_email?: string;
  contact_name?: string;
  fit_score?: number;
  stage?: string;
  dc_gate?: string;
  notes?: string;
  last_contact?: string | null;
  next_followup?: string | null;
  deal_value?: number;
  touch_count?: number;
};

const STATE_FILE = path.join(process.cwd(), "data", "ops-dashboard.json");
const CRM_FILE = path.resolve(
  process.cwd(),
  "..",
  "Yanchan-Produced",
  "Brand-Deals-Engine",
  "04_Operations",
  "crm_local.json"
);
// The clip pipeline's store of record. It used to be `clips/strategy.md`, scraped
// as markdown, with the file path GUESSED from an old naming convention -- so every
// preview 404'd. library.json carries the real relative path for each clip.
const CLIP_LIBRARY_FILE = path.resolve(
  process.cwd(),
  "..",
  "clips",
  "library.json"
);

type LibraryClip = {
  path: string;
  date?: string;
  start?: number;
  duration?: number;
  score?: number;
  context_tag?: string;
  mode?: string;
  excerpt?: string;
  status?: string;
  scheduled?: string;
  copy?: { hook?: string; hook_alt?: string; caption?: string };
};

type LibraryFile = { version?: number; clips?: Record<string, LibraryClip> };

const LIBRARY_STATUS_TO_CLIP: Record<string, ClipStatus> = {
  new: "Pending Review",
  approved: "Approved",
  needs_edit: "Needs Edit",
  scheduled: "Scheduled",
  posted: "Posted",
  rejected: "Rejected",
};

const CLIP_STATUS_TO_LIBRARY: Record<ClipStatus, string> = {
  "Pending Review": "new",
  Approved: "approved",
  "Needs Edit": "needs_edit",
  Scheduled: "scheduled",
  Posted: "posted",
  Rejected: "rejected",
};

const TAG_PLATFORMS: Record<string, { primary: string; cross: string }> = {
  singing: { primary: "TikTok / Reels / Shorts", cross: "X" },
  beat: { primary: "TikTok / Reels / Shorts", cross: "X" },
};

function fmtVodTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

const BRIDGE_PRIORITY: Record<string, number> = {
  NorBlackNorWhite: 1,
  Mejuri: 2,
  "Native Instruments": 3,
  Arturia: 4,
  "Manish Malhotra": 5,
};

const SUGGESTED_DEAL_VALUES: Record<string, number> = {
  Ableton: 5000,
  "Native Instruments": 4000,
  "Universal Audio": 4000,
  "RME Audio": 3500,
  Sennheiser: 3500,
  Output: 3500,
  Arturia: 3000,
  Spectrasonics: 3000,
  "Waves Audio": 3000,
  iZotope: 3000,
  NorBlackNorWhite: 3500,
  Jaywalking: 3000,
  BISKIT: 3000,
  Mejuri: 2500,
  "Manish Malhotra": 4000,
  Pero: 2500,
  FabFilter: 2500,
  Soundtoys: 2500,
  Cableguys: 2000,
  "XLN Audio": 2500,
  Toontrack: 2000,
  Whoop: 3000,
  Oura: 3000,
  "Athletic Greens": 2500,
  LMNT: 2000,
  Momentous: 2000,
  Nike: 8000,
  Adidas: 5000,
  OVO: 5000,
  Roots: 3000,
  KOTN: 2500,
};

async function readJsonState() {
  const raw = await readFile(STATE_FILE, "utf8");
  return JSON.parse(raw) as OpsDashboardState;
}

async function readSeedDeals(): Promise<Deal[]> {
  try {
    const raw = await readFile(CRM_FILE, "utf8");
    const rows = JSON.parse(raw) as RawDeal[];

    return rows
      .map((row, index) => {
        const brand = row.brand || `Brand ${index + 1}`;
        const priority = BRIDGE_PRIORITY[brand] ?? 100 + index;
        const fitScore = Number(row.fit_score ?? 0);
        const rawGate = row.dc_gate || "Unscored";
        const gate =
          rawGate === "Archive" && fitScore === 0 ? "Needs Score" : rawGate;

        return {
          id: row.id || `BD-${String(index + 1).padStart(4, "0")}`,
          brand,
          category: row.category || "Uncategorized",
          website: row.website || "",
          contactName: row.contact_name || "",
          contactEmail: row.contact_email || "",
          fitScore,
          stage: normalizeStage(row.stage),
          gate,
          priority,
          dealValue: Number(row.deal_value || SUGGESTED_DEAL_VALUES[brand] || 2500),
          nextAction:
            priority <= 5
              ? "Build dossier, score fit, draft bridge-specific Touch-1"
              : "Hold until first bridge case study or weekly brand hunt",
          nextDue: priority <= 5 ? "2026-06-29" : "2026-07-06",
          owner: "Gobbe",
          lastTouch: row.last_contact || "",
          touchCount: Number(row.touch_count || 0),
          notes:
            row.notes ||
            (priority <= 5
              ? "Bridge-priority target from 00-System retargeting."
              : "Seeded from local CRM backup."),
        } satisfies Deal;
      })
      .sort((a, b) => a.priority - b.priority);
  } catch {
    return [
      {
        id: "BD-0011",
        brand: "NorBlackNorWhite",
        category: "South Asian Fashion",
        website: "nbnw.co",
        contactName: "",
        contactEmail: "",
        fitScore: 0,
        stage: "Identified",
        gate: "Needs Score",
        priority: 1,
        dealValue: 3500,
        nextAction: "Build dossier, score fit, draft bridge-specific Touch-1",
        nextDue: "2026-06-29",
        owner: "Gobbe",
        lastTouch: "",
        touchCount: 0,
        notes: "Bridge-priority target from 00-System retargeting.",
      },
    ];
  }
}

async function readLibrary(): Promise<LibraryClip[]> {
  try {
    const raw = await readFile(CLIP_LIBRARY_FILE, "utf8");
    const parsed = JSON.parse(raw) as LibraryFile;
    return Object.entries(parsed.clips ?? {}).map(([clipPath, clip]) => ({
      ...clip,
      path: clip.path ?? clipPath,
    }));
  } catch {
    return [];
  }
}

function libraryToClip(entry: LibraryClip, index: number): Clip {
  const tag = entry.context_tag ?? "beat";
  const platforms = TAG_PLATFORMS[tag] ?? { primary: "TikTok / Reels / Shorts", cross: "X" };
  const ctas = [
    "Free Tamil-trap drum kit in bio",
    "DM BEATS for the kit",
    "Full session live on Kick",
  ];

  return {
    id: entry.path,
    start: fmtVodTime(entry.start ?? 0),
    context: tag,
    duration: `${(entry.duration ?? 0).toFixed(1)}s`,
    score: entry.score ?? 0,
    platform: platforms.primary,
    crossPost: platforms.cross,
    hook: entry.copy?.hook ?? "",
    cta: ctas[index % ctas.length],
    status: LIBRARY_STATUS_TO_CLIP[entry.status ?? "new"] ?? "Pending Review",
    schedule: entry.scheduled ?? "",
    sourcePath: entry.path,
    notes: entry.excerpt ? `“${entry.excerpt}”` : "Human review required before posting.",
  };
}

/** Clips come from the library; review state comes from whatever was saved here.
 *  Keyed on the clip's path, so re-running the pipeline adds new clips without
 *  losing approvals, and deleting a clip removes it instead of leaving a ghost. */
function reconcileClips(library: LibraryClip[], saved: Clip[]): Clip[] {
  const savedByPath = new Map(saved.map((c) => [c.sourcePath, c]));
  return library
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (a.start ?? 0) - (b.start ?? 0))
    .map((entry, index) => {
      const base = libraryToClip(entry, index);
      const prior = savedByPath.get(entry.path);
      if (!prior) return base;
      return {
        ...base,
        status: prior.status,
        schedule: prior.schedule,
        cta: prior.cta || base.cta,
        hook: base.hook || prior.hook,
        notes: prior.notes || base.notes,
      };
    });
}

async function readSeedClips(): Promise<Clip[]> {
  return reconcileClips(await readLibrary(), []);
}

/*
 * There was a `writeStatusesToLibrary()` here, and it was the only second writer
 * to `clips/library.json` in the codebase.
 *
 * That file is the store of record, and the protection around it is a single
 * writer plus a merge-never-overwrite contract (design D9) — `library.py` and
 * the /api/yp routes both honour it. This function did neither: it read the
 * whole file, mutated it, and wrote the whole thing back from a legacy screen
 * that runs on its own state file. Two writers with no lock, one of them
 * rewriting wholesale, is how a batch's `work_dir` and framing locks disappear
 * with nothing in the logs.
 *
 * The legacy screen still READS the library, which is the part it needs. Its
 * review state lives in `data/ops-dashboard.json` and stays there; the YP Dash
 * Review screen is what writes approvals, through `library.record_*`.
 */

async function buildDefaultState(): Promise<OpsDashboardState> {
  const [deals, clips] = await Promise.all([readSeedDeals(), readSeedClips()]);

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    metrics: {
      emailSubscribers: 0,
      emailDelta: 0,
      monthlyListeners: 236000,
      monthlyListenersDelta: 0,
      socialAudience: 258000,
      targetClipsPerWeek: 8,
      targetEmailsPerWeek: 5,
      pipelineTarget: 25000,
    },
    deals,
    clips,
    tasks: [
      {
        id: "task-capture-cadence",
        title: "Lock one weekly content capture with Yanchan/Mic",
        area: "Content",
        owner: "Gobbe",
        due: "2026-06-29",
        status: "To Do",
        urgency: "High",
      },
      {
        id: "task-clip-review",
        title: "Review and approve top 8 Kick stream clips",
        area: "Content",
        owner: "Yanchan",
        due: "2026-06-29",
        status: "To Do",
        urgency: "High",
      },
      {
        id: "task-crm-gate",
        title: "Clear CRM default Archive gate and score First 5",
        area: "Brand Deals",
        owner: "Gobbe",
        due: "2026-06-29",
        status: "To Do",
        urgency: "High",
      },
      {
        id: "task-nbnw-dossier",
        title: "Build NorBlackNorWhite dossier and Touch-1 concept",
        area: "Brand Deals",
        owner: "Gobbe",
        due: "2026-06-30",
        status: "To Do",
        urgency: "High",
      },
      {
        id: "task-media-kit",
        title: "Export synced media kit PDF with 12M / 236K / 258K metrics",
        area: "Brand Deals",
        owner: "Gobbe",
        due: "2026-07-01",
        status: "To Do",
        urgency: "Medium",
      },
      {
        id: "task-kit-funnel",
        title: "Wire Kit form tags for Producer, Artist, and Fan segments",
        area: "Funnel",
        owner: "Gobbe",
        due: "2026-07-01",
        status: "To Do",
        urgency: "Medium",
      },
      {
        id: "task-weekly-brief",
        title: "Log first Monday Weekly Intelligence brief",
        area: "Weekly Intel",
        owner: "Gobbe",
        due: "2026-06-29",
        status: "To Do",
        urgency: "Medium",
      },
    ],
    activity: [
      {
        id: "activity-system-cutover",
        timestamp: "2026-06-27T09:00:00.000Z",
        area: "System",
        title: "Lean operating system installed",
        detail:
          "00-System replaced the 10-agent swarm with Content Engine, Brand Deals, and Weekly Intelligence.",
      },
      {
        id: "activity-clip-pipeline",
        timestamp: "2026-06-27T09:15:00.000Z",
        area: "Content",
        title: "Kick stream clip pipeline produced 30 clips",
        detail:
          "Top candidates are ready for human review before any posting or scheduling.",
      },
      {
        id: "activity-crm-audit",
        timestamp: "2026-06-27T09:30:00.000Z",
        area: "Brand Deals",
        title: "CRM audit found 31 unscored identified brands",
        detail:
          "Every local CRM row had score 0 and Archive gate; dashboard flags this as the first fix.",
      },
      {
        id: "activity-funnel",
        timestamp: "2026-06-27T09:45:00.000Z",
        area: "Funnel",
        title: "Owned audience funnel selected Kit",
        detail:
          "Email subscribers are the north-star metric; segment tags are Producer, Artist, and Fan.",
      },
    ],
    weeklyBriefs: [],
  };
}

async function loadState() {
  try {
    const saved = await readJsonState();
    // Saved state used to be returned verbatim, so clips rendered after the first
    // save never appeared. Clips are re-read from the library every load.
    const library = await readLibrary();
    if (library.length) {
      return { ...saved, clips: reconcileClips(library, saved.clips ?? []) };
    }
    return saved;
  } catch {
    return buildDefaultState();
  }
}

function isValidState(value: unknown): value is OpsDashboardState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpsDashboardState>;
  return (
    Array.isArray(candidate.deals) &&
    Array.isArray(candidate.clips) &&
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.activity) &&
    Boolean(candidate.metrics)
  );
}

export async function GET() {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  const state = await loadState();
  return NextResponse.json(state);
}

export async function PUT(req: Request) {
  if (!INTERNAL_TOOLS_ENABLED) return new NextResponse(null, { status: 404 });
  try {
    const incoming = await req.json();
    if (!isValidState(incoming)) {
      return NextResponse.json({ error: "Invalid dashboard state" }, { status: 400 });
    }

    const nextState: OpsDashboardState = {
      ...incoming,
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");

    return NextResponse.json(nextState);
  } catch {
    return NextResponse.json({ error: "Unable to save dashboard state" }, { status: 500 });
  }
}
