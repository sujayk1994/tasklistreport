import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Tag as TagIcon,
  Layers,
  LayoutGrid,
  X,
  GripVertical,
  Check,
  MessageSquare,
  Copy,
  Trash2,
  Calendar,
  Clock,
  Flame,
  CheckCircle2,
  Circle,
  Zap,
  FolderCheck,
  RotateCcw,
  Inbox,
  Magnet,
  Send,
  Pencil,
} from "lucide-react";
import { HighlightedText } from "@/lib/highlight";

export type BoardTask = {
  id: number;
  text: string;
  completed: boolean;
  note: string;
  position: number;
  createdAt?: string;
  // Notes the user has dragged into the "Posted for Future" folder. They are
  // hidden from the live board, surfaced in their own pinned panel, included
  // in the daily email report, and intentionally NOT carried into tomorrow.
  postedForFuture?: boolean;
};

type TagDef = {
  id: string;
  name: string;
  keyword: string;
  swatch: string;
  paper: string;
  ink: string;
  border: string;
  ribbon: string;
  glow: string;
};

type Pos = { x: number; y: number; rot: number };

const NOTE_W = 250;
const NOTE_H = 220; // estimated for clamping; notes can grow taller when notes/comments expand
const PAD = 12;
const COL_GAP = 24;
const ROW_GAP = 32;
const MIN_GAP = 8; // minimum gap between two notes when checking overlap

const DEFAULT_TAGS: TagDef[] = [
  { id: "t-client", name: "Client Change", keyword: "client change",
    swatch: "#8B5CF6", paper: "linear-gradient(135deg, #F3EBFF 0%, #E5D5FF 100%)",
    ink: "#3B1D75", border: "#C7B2FF", ribbon: "#7C3AED", glow: "rgba(139, 92, 246, 0.18)" },
  { id: "t-bug", name: "Bug Fix", keyword: "bug fix",
    swatch: "#EF4444", paper: "linear-gradient(135deg, #FFE7E2 0%, #FFD1C7 100%)",
    ink: "#7A1B1B", border: "#FFB4A8", ribbon: "#DC2626", glow: "rgba(239, 68, 68, 0.18)" },
  { id: "t-internal", name: "Internal", keyword: "internal",
    swatch: "#0EA5E9", paper: "linear-gradient(135deg, #E1F3FF 0%, #C9E8FF 100%)",
    ink: "#0B3B66", border: "#A8D8FF", ribbon: "#0284C7", glow: "rgba(14, 165, 233, 0.18)" },
  { id: "t-review", name: "Review", keyword: "review",
    swatch: "#F59E0B", paper: "linear-gradient(135deg, #FFF1CC 0%, #FFE39A 100%)",
    ink: "#5C3A06", border: "#FFD976", ribbon: "#D97706", glow: "rgba(245, 158, 11, 0.18)" },
];

const NEUTRAL: TagDef = {
  id: "untagged", name: "Untagged", keyword: "",
  swatch: "#94A3B8", paper: "linear-gradient(135deg, #FBFBF6 0%, #F2EFE3 100%)",
  ink: "#26324A", border: "#E4DFCE", ribbon: "#94A3B8", glow: "rgba(148, 163, 184, 0.15)",
};

const PALETTE: Omit<TagDef, "id" | "name" | "keyword">[] = [
  { swatch: "#8B5CF6", paper: "linear-gradient(135deg,#F3EBFF 0%,#E5D5FF 100%)", ink: "#3B1D75", border: "#C7B2FF", ribbon: "#7C3AED", glow: "rgba(139,92,246,.18)" },
  { swatch: "#EF4444", paper: "linear-gradient(135deg,#FFE7E2 0%,#FFD1C7 100%)", ink: "#7A1B1B", border: "#FFB4A8", ribbon: "#DC2626", glow: "rgba(239,68,68,.18)" },
  { swatch: "#0EA5E9", paper: "linear-gradient(135deg,#E1F3FF 0%,#C9E8FF 100%)", ink: "#0B3B66", border: "#A8D8FF", ribbon: "#0284C7", glow: "rgba(14,165,233,.18)" },
  { swatch: "#F59E0B", paper: "linear-gradient(135deg,#FFF1CC 0%,#FFE39A 100%)", ink: "#5C3A06", border: "#FFD976", ribbon: "#D97706", glow: "rgba(245,158,11,.18)" },
  { swatch: "#10B981", paper: "linear-gradient(135deg,#DCFCE7 0%,#BBF7D0 100%)", ink: "#064E3B", border: "#A7F3D0", ribbon: "#059669", glow: "rgba(16,185,129,.18)" },
  { swatch: "#EC4899", paper: "linear-gradient(135deg,#FDE7F3 0%,#FBCFE8 100%)", ink: "#831843", border: "#FBCFE8", ribbon: "#DB2777", glow: "rgba(236,72,153,.18)" },
  { swatch: "#6366F1", paper: "linear-gradient(135deg,#E6E8FF 0%,#C7CCFF 100%)", ink: "#1E1B4B", border: "#C7CCFF", ribbon: "#4F46E5", glow: "rgba(99,102,241,.18)" },
  { swatch: "#14B8A6", paper: "linear-gradient(135deg,#CCFBF1 0%,#99F6E4 100%)", ink: "#134E4A", border: "#99F6E4", ribbon: "#0D9488", glow: "rgba(20,184,166,.18)" },
];

const PRIORITY_KEYWORDS = ["urgent", "priority"];
export function isPriorityTitle(title: string): boolean {
  const t = title.toLowerCase();
  return PRIORITY_KEYWORDS.some((k) => t.includes(k));
}

export function daysSinceCreated(createdAt: string | undefined | null): number {
  if (!createdAt) return 0;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return 0;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const created = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(0, Math.round((start.getTime() - created.getTime()) / 86400000));
}

function matchTag(title: string, tags: TagDef[]): TagDef {
  const t = title.toLowerCase();
  for (const tag of tags) {
    if (tag.keyword && t.includes(tag.keyword)) return tag;
  }
  return NEUTRAL;
}

const TAGS_KEY = "task-board-tags-v1";
const POS_KEY = "task-board-positions-v1";
const STACK_KEY = "task-board-stacked-v1";
const TRASH_KEY = "task-board-trash-v1";
const SNAP_KEY = "task-board-snap-v1";
const TAG_OVERRIDES_KEY = "task-board-tag-overrides-v1";

function loadTagOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TAG_OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function snapToGrid(p: { x: number; y: number }): { x: number; y: number } {
  const colW = NOTE_W + COL_GAP;
  const rowH = NOTE_H + ROW_GAP;
  return {
    x: PAD + Math.round((p.x - PAD) / colW) * colW,
    y: PAD + Math.round((p.y - PAD) / rowH) * rowH,
  };
}

function loadSnap(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SNAP_KEY) === "1";
  } catch {
    return false;
  }
}

// Tiny synthesized "tada" using the Web Audio API — no asset needed.
function playCelebrationSound() {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones = [
      { f: 523.25, t: 0 },     // C5
      { f: 659.25, t: 0.09 },  // E5
      { f: 783.99, t: 0.18 },  // G5
      { f: 1046.5, t: 0.27 },  // C6
    ];
    for (const { f, t } of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, now + t);
      g.gain.setValueAtTime(0, now + t);
      g.gain.linearRampToValueAtTime(0.18, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.35);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + t);
      o.stop(now + t + 0.4);
    }
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* sound is optional; never let it break the drop */
  }
}

const CONFETTI_COLORS = [
  "#7C3AED", "#EC4899", "#F59E0B", "#10B981",
  "#0EA5E9", "#EF4444", "#FACC15", "#A855F7",
];

type Burst = { id: number; x: number; y: number };

type TrashItem = {
  id: number;
  text: string;
  note?: string;
  createdAt?: string;
  deletedAt: string;
};
type TrashStore = { date: string; items: TrashItem[] };

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadTrash(): TrashStore {
  if (typeof window === "undefined") return { date: todayKey(), items: [] };
  try {
    const raw = window.localStorage.getItem(TRASH_KEY);
    if (!raw) return { date: todayKey(), items: [] };
    const parsed = JSON.parse(raw) as TrashStore;
    if (!parsed || parsed.date !== todayKey()) {
      return { date: todayKey(), items: [] };
    }
    return parsed;
  } catch {
    return { date: todayKey(), items: [] };
  }
}

function loadTags(): TagDef[] {
  if (typeof window === "undefined") return DEFAULT_TAGS;
  try {
    const raw = window.localStorage.getItem(TAGS_KEY);
    if (!raw) return DEFAULT_TAGS;
    const parsed = JSON.parse(raw) as TagDef[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TAGS;
  } catch {
    return DEFAULT_TAGS;
  }
}
function loadPositions(): Record<string, Pos> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Pos>) : {};
  } catch {
    return {};
  }
}
function loadStacks(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STACK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function formatDateLabel(daysAgo: number, createdAt?: string) {
  const stale = daysAgo >= 7;
  if (daysAgo === 0) {
    return { label: "Added today", isPending: false, daysAgo: 0, stale: false };
  }
  let formatted = "";
  if (createdAt) {
    const d = new Date(createdAt);
    if (!isNaN(d.getTime())) {
      formatted = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
  }
  return { label: `Pending from ${formatted}`, isPending: true, daysAgo, stale };
}

function clampPos(p: Pos, width: number, _height?: number): Pos {
  // Only clamp horizontally — the board scrolls vertically so notes can live anywhere below.
  const maxX = Math.max(PAD, width - NOTE_W - PAD);
  const x = Math.min(Math.max(PAD, Number.isFinite(p.x) ? p.x : PAD), maxX);
  const y = Math.max(PAD, Number.isFinite(p.y) ? p.y : PAD);
  return { x, y, rot: Number.isFinite(p.rot) ? p.rot : 0 };
}

function rectsOverlap(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return (
    a.x < b.x + NOTE_W + MIN_GAP &&
    b.x < a.x + NOTE_W + MIN_GAP &&
    a.y < b.y + NOTE_H + MIN_GAP &&
    b.y < a.y + NOTE_H + MIN_GAP
  );
}

// Find an empty grid slot that doesn't overlap any of the `occupied` positions.
function findFreeSlot(occupied: Array<{ x: number; y: number }>, width: number): Pos {
  const colW = NOTE_W + COL_GAP;
  const rowH = NOTE_H + ROW_GAP;
  const cols = Math.max(1, Math.floor((width - PAD * 2) / colW));
  const maxRows = Math.max(1, Math.ceil(occupied.length / cols) + 6);
  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < cols; c++) {
      const candidate = { x: PAD + c * colW, y: PAD + r * rowH };
      let collides = false;
      for (const o of occupied) {
        if (rectsOverlap(candidate, o)) {
          collides = true;
          break;
        }
      }
      if (!collides) return { x: candidate.x, y: candidate.y, rot: 0 };
    }
  }
  // Fallback: stick it just below the lowest occupied note.
  const maxY = occupied.reduce((m, o) => Math.max(m, o.y), PAD);
  return { x: PAD, y: maxY + rowH, rot: 0 };
}

// Place a brand-new task next to existing tasks that share its tag, so it lands
// in the right "row" instead of dropping into a random gap between unrelated notes.
function findSlotForTag(
  newTask: BoardTask,
  positions: Record<string, Pos>,
  tasks: BoardTask[],
  tags: TagDef[],
  width: number,
  occupied: Array<{ x: number; y: number }>,
  tagOverrides: Record<string, string> = {},
): Pos {
  const resolveTagId = (t: BoardTask): string => {
    const override = tagOverrides[String(t.id)];
    if (override) return override;
    return matchTag(t.text, tags).id;
  };
  const tagId = resolveTagId(newTask);
  const colW = NOTE_W + COL_GAP;
  const rowH = NOTE_H + ROW_GAP;
  const cols = Math.max(1, Math.floor((width - PAD * 2) / colW));

  // Existing positions of tasks that share the same tag.
  const sameTag = tasks
    .filter((t) => t.id !== newTask.id && positions[String(t.id)])
    .filter((t) => resolveTagId(t) === tagId)
    .map((t) => positions[String(t.id)]);

  if (sameTag.length === 0) return findFreeSlot(occupied, width);

  // Anchor on the bottom-most note in this tag group.
  const anchor = sameTag.reduce((acc, p) =>
    p.y > acc.y || (p.y === acc.y && p.x > acc.x) ? p : acc,
  );

  // Try the same row first (right of anchor, then any empty column on that row),
  // then drop down one row at a time until we find a free spot.
  for (let rOffset = 0; rOffset < 12; rOffset++) {
    const y = anchor.y + rOffset * rowH;
    // Prefer the column right after the anchor on the same row.
    const startCol = rOffset === 0
      ? Math.min(cols - 1, Math.max(0, Math.round((anchor.x - PAD) / colW)) + 1)
      : 0;
    for (let i = 0; i < cols; i++) {
      const c = (startCol + i) % cols;
      const candidate = { x: PAD + c * colW, y };
      let collides = false;
      for (const o of occupied) {
        if (rectsOverlap(candidate, o)) {
          collides = true;
          break;
        }
      }
      if (!collides) return { x: candidate.x, y: candidate.y, rot: 0 };
    }
  }
  return findFreeSlot(occupied, width);
}

class BoardErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[BoardView] crashed:", error);
  }
  reset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-3xl border border-amber-300 bg-amber-50/60 p-6 text-center">
          <h3 className="text-base font-semibold text-amber-900 mb-1">
            The board hit a snag
          </h3>
          <p className="text-sm text-amber-800 mb-4">
            Something went wrong rendering the sticky board. Your tasks are safe —
            you can keep working in List view, or try resetting the board layout.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="px-3 py-1.5 rounded-md bg-amber-700 text-white text-sm font-medium hover:bg-amber-800"
            >
              Reset board layout
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

export function BoardViewSafe(props: Props) {
  const reset = () => {
    try {
      window.localStorage.removeItem(POS_KEY);
      window.localStorage.removeItem(STACK_KEY);
    } catch {}
    window.location.reload();
  };
  return (
    <BoardErrorBoundary onReset={reset}>
      <BoardView {...props} />
    </BoardErrorBoundary>
  );
}

// Auto-layout: arrange tasks by tag in lanes — straight, no overlap, no rotation.
// The board scrolls vertically, so height is unbounded; only width matters for column count.
// `heights` (optional) carries each note's actual rendered height so rows stay
// snug — without it the layout falls back to a conservative estimate, which is
// what produces the "extra blank space between rows" the user complained about.
function autoLayout(
  tasks: BoardTask[],
  tags: TagDef[],
  width: number,
  heights?: Record<number, number>,
  tagOverrides: Record<string, string> = {},
): Record<number, Pos> {
  const resolveTagId = (t: BoardTask): string => {
    const override = tagOverrides[String(t.id)];
    if (override) return override;
    return matchTag(t.text, tags).id;
  };
  const groups = new Map<string, BoardTask[]>();
  for (const t of tasks) {
    const tagId = resolveTagId(t);
    if (!groups.has(tagId)) groups.set(tagId, []);
    groups.get(tagId)!.push(t);
  }
  const order = [...tags.map((t) => t.id), NEUTRAL.id];

  const colW = NOTE_W + COL_GAP;
  const cols = Math.max(1, Math.floor((width - PAD * 2) / colW));
  const TIDY_ROW_GAP = 14; // tighter than ROW_GAP — actual heights remove the slack.
  const positions: Record<number, Pos> = {};

  const heightFor = (id: number) => {
    const h = heights?.[id];
    if (typeof h === "number" && Number.isFinite(h) && h > 0) return h;
    return 150; // sensible minimum for a collapsed note
  };

  let yCursor = PAD;
  for (const tagId of order) {
    const list = groups.get(tagId);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.position - b.position);

    let rowMaxH = 0;
    list.forEach((task, ix) => {
      const col = ix % cols;
      if (col === 0 && ix > 0) {
        yCursor += rowMaxH + TIDY_ROW_GAP;
        rowMaxH = 0;
      }
      const h = heightFor(task.id);
      if (h > rowMaxH) rowMaxH = h;
      positions[task.id] = {
        x: PAD + col * colW,
        y: yCursor,
        rot: 0,
      };
    });
    yCursor += rowMaxH + TIDY_ROW_GAP;
  }
  return positions;
}

type Props = {
  tasks: BoardTask[];
  isSubmitted: boolean;
  searchQuery: string;
  searchMode: "name" | "date";
  ageFilter: "all" | "newer" | "older" | "priority";
  completedFilter: "all" | "done" | "pending" | "posted";
  onToggle: (taskId: number) => void;
  onDelete: (taskId: number) => void;
  onCopy: (text: string) => void;
  onNoteChange: (taskId: number, note: string) => void;
  onNoteBlur: (taskId: number, note: string) => void;
  comments: Record<number, string>;
  // Optional enhancements (all default-safe).
  darkMode?: boolean;
  celebrations?: boolean;
  tidyTrigger?: number;
  onRestore?: (text: string, note?: string) => void;
  // When true, the in-board tag/snap/tidy toolbar is hidden so the board
  // canvas takes the entire surface (used by Zen mode).
  hideToolbar?: boolean;
  // Inline-edit a task's title text. Falls back gracefully when omitted.
  onTextChange?: (taskId: number, text: string) => void;
  // Mark / unmark a task as "Posted for Future".
  onSetPostedForFuture?: (taskId: number, value: boolean) => void;
};

export function BoardView({
  tasks,
  isSubmitted,
  searchQuery,
  searchMode,
  ageFilter,
  completedFilter,
  onToggle,
  onDelete,
  onCopy,
  onNoteChange,
  onNoteBlur,
  comments,
  darkMode = false,
  celebrations = false,
  tidyTrigger,
  onRestore,
  hideToolbar = false,
  onTextChange,
  onSetPostedForFuture,
}: Props) {
  const [tags, setTags] = useState<TagDef[]>(() => loadTags());
  const [positions, setPositions] = useState<Record<string, Pos>>(() => loadPositions());
  const [stackedGroups, setStackedGroups] = useState<Record<string, boolean>>(() => loadStacks());
  // Per-task tag overrides (taskId -> tagId, or "untagged"). When set, this
  // wins over keyword-matching against the task title.
  const [tagOverrides, setTagOverrides] = useState<Record<string, string>>(() => loadTagOverrides());
  // Which task currently has its tag-picker popover open.
  const [openTagPickerFor, setOpenTagPickerFor] = useState<number | null>(null);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagKeyword, setNewTagKeyword] = useState("");
  const [newTagSwatch, setNewTagSwatch] = useState(PALETTE[0].swatch);
  const [openNoteFor, setOpenNoteFor] = useState<number | null>(null);
  const [boardWidth, setBoardWidth] = useState<number>(1200);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // Recycle bin (deleted items, auto-cleared at end of day) + Completed folder
  // + "Posted for Future" folder (right-centre).
  const [trash, setTrash] = useState<TrashStore>(() => loadTrash());
  const [binOpen, setBinOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [postedOpen, setPostedOpen] = useState(false);
  const [dropHover, setDropHover] = useState<null | "bin" | "folder" | "posted">(null);
  const binRef = useRef<HTMLButtonElement | null>(null);
  const folderRef = useRef<HTMLButtonElement | null>(null);
  const postedRef = useRef<HTMLButtonElement | null>(null);

  // Inline title editor — when set, the task's <h3> swaps for an input.
  const [editingTextFor, setEditingTextFor] = useState<number | null>(null);
  const [editTextDraft, setEditTextDraft] = useState<string>("");

  // Snap-to-grid toggle (persisted on this device).
  const [snap, setSnap] = useState<boolean>(() => loadSnap());

  // Confetti bursts triggered when a note lands in Completed.
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burstIdRef = useRef(1);

  // Track each note's actual rendered height so Tidy can pack rows tightly
  // instead of using the conservative NOTE_H estimate (which was leaving
  // empty bands between rows of short notes).
  const noteHeightsRef = useRef<Record<number, number>>({});
  const setNoteEl = (id: number) => (el: HTMLDivElement | null) => {
    if (!el) {
      delete noteHeightsRef.current[id];
      return;
    }
    const h = el.getBoundingClientRect().height;
    if (h > 0) noteHeightsRef.current[id] = h;
  };

  // Spawn a quick burst of colourful pieces around (x, y) within the board.
  const fireConfetti = (x: number, y: number) => {
    const id = burstIdRef.current++;
    setBursts((prev) => [...prev, { id, x, y }]);
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== id));
    }, 1200);
  };

  useEffect(() => {
    try { window.localStorage.setItem(TAGS_KEY, JSON.stringify(tags)); } catch {}
  }, [tags]);
  useEffect(() => {
    try { window.localStorage.setItem(POS_KEY, JSON.stringify(positions)); } catch {}
  }, [positions]);
  useEffect(() => {
    try { window.localStorage.setItem(STACK_KEY, JSON.stringify(stackedGroups)); } catch {}
  }, [stackedGroups]);
  useEffect(() => {
    try { window.localStorage.setItem(TRASH_KEY, JSON.stringify(trash)); } catch {}
  }, [trash]);
  useEffect(() => {
    try { window.localStorage.setItem(SNAP_KEY, snap ? "1" : "0"); } catch {}
  }, [snap]);
  useEffect(() => {
    try { window.localStorage.setItem(TAG_OVERRIDES_KEY, JSON.stringify(tagOverrides)); } catch {}
  }, [tagOverrides]);

  // Close the per-card tag picker when clicking anywhere outside of it.
  useEffect(() => {
    if (openTagPickerFor === null) return;
    const onDown = () => setOpenTagPickerFor(null);
    // Use capture so it fires before our buttons stopPropagation kicks in,
    // but the picker's own children call stopPropagation already so this only
    // fires for true outside clicks.
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openTagPickerFor]);

  // Resolve the tag for a task: explicit override (taskId -> tagId) wins,
  // otherwise fall back to keyword matching against the task text.
  const getTagFor = (task: BoardTask): TagDef => {
    const overrideId = tagOverrides[String(task.id)];
    if (overrideId) {
      if (overrideId === NEUTRAL.id) return NEUTRAL;
      const found = tags.find((t) => t.id === overrideId);
      if (found) return found;
    }
    return matchTag(task.text, tags);
  };

  const setTagFor = (taskId: number, tagId: string | null) => {
    setTagOverrides((prev) => {
      const next = { ...prev };
      if (tagId === null) {
        delete next[String(taskId)];
      } else {
        next[String(taskId)] = tagId;
      }
      return next;
    });
  };

  // Auto-clear the recycle bin when the date changes (end of day).
  useEffect(() => {
    const tick = () => {
      setTrash((prev) =>
        prev.date === todayKey() ? prev : { date: todayKey(), items: [] },
      );
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // boardRef points at the inner relative canvas (where notes are absolutely positioned).
  const boardRef = useRef<HTMLDivElement | null>(null);
  // scrollRef points at the outer scroll container.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Track board width for clamping & column count. Height grows with content.
  useLayoutEffect(() => {
    if (!boardRef.current) return;
    const el = boardRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        setBoardWidth((prev) =>
          Math.abs(prev - r.width) < 0.5 ? prev : r.width,
        );
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // When the board narrows, pull every saved position back inside the horizontal bounds.
  useEffect(() => {
    if (boardWidth <= 0) return;
    setPositions((prev) => {
      let changed = false;
      const next: Record<string, Pos> = {};
      for (const [k, p] of Object.entries(prev)) {
        const c = clampPos(p, boardWidth);
        if (c.x !== p.x || c.y !== p.y) changed = true;
        next[k] = c;
      }
      return changed ? next : prev;
    });
  }, [boardWidth]);

  // Auto-layout any task without a saved position — never overlapping existing notes.
  // New tasks are placed next to existing notes that share their tag, so a new
  // note lands at the end of the right "row" instead of in a random gap between
  // unrelated notes.
  useEffect(() => {
    if (boardWidth <= 0) return;
    const missing = tasks.filter((t) => !positions[String(t.id)]);
    if (missing.length === 0) return;
    setPositions((prev) => {
      const next = { ...prev };
      const occupied: Array<{ x: number; y: number }> = Object.values(next).map(
        (p) => ({ x: p.x, y: p.y }),
      );
      for (const t of missing) {
        const slot = findSlotForTag(t, next, tasks, tags, boardWidth, occupied, tagOverrides);
        next[String(t.id)] = slot;
        occupied.push({ x: slot.x, y: slot.y });
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, boardWidth, tags]);

  // Filter logic.
  const trimmedQuery = searchQuery.trim();
  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      const isPosted = !!t.postedForFuture;
      // Posted-for-future tasks live in their own folder; hide them from the
      // main board unless the user explicitly filters to "Posted".
      if (isPosted && completedFilter !== "posted") return false;
      if (completedFilter === "posted" && !isPosted) return false;
      // Completed tasks live in the Completed folder; hide them from the board
      // unless the user explicitly filters to "Done".
      if (t.completed && completedFilter !== "done") return false;
      if (completedFilter === "done" && !t.completed) return false;
      if (completedFilter === "pending" && t.completed) return false;
      const days = daysSinceCreated(t.createdAt);
      if (ageFilter === "newer" && days > 1) return false;
      if (ageFilter === "older" && days < 2) return false;
      if (ageFilter === "priority" && !isPriorityTitle(t.text)) return false;
      if (trimmedQuery) {
        if (searchMode === "name") {
          const haystack = `${t.text} ${t.note ?? ""}`.toLowerCase();
          if (!haystack.includes(trimmedQuery.toLowerCase())) return false;
        } else if (searchMode === "date") {
          if (!t.createdAt) return false;
          const d = new Date(t.createdAt);
          if (isNaN(d.getTime())) return false;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          if (key !== trimmedQuery) return false;
        }
      }
      return true;
    });
  }, [tasks, completedFilter, ageFilter, trimmedQuery, searchMode]);

  const visibleIds = useMemo(() => new Set(visibleTasks.map((t) => t.id)), [visibleTasks]);

  // Completed-folder contents are derived directly from the source list so
  // they always reflect the latest backend state.
  const completedTasks = useMemo(
    () => tasks.filter((t) => t.completed && !t.postedForFuture),
    [tasks],
  );
  const completedCount = completedTasks.length;

  // Posted-for-future folder contents.
  const postedTasks = useMemo(
    () => tasks.filter((t) => t.postedForFuture && !t.completed),
    [tasks],
  );
  const postedCount = postedTasks.length;

  // Group visible tasks by tag, with completed tasks pushed to the end of each group.
  const grouped = useMemo(() => {
    const out: Record<string, { tag: TagDef; tasks: BoardTask[] }> = {};
    for (const task of visibleTasks) {
      const tag = getTagFor(task);
      if (!out[tag.id]) out[tag.id] = { tag, tasks: [] };
      out[tag.id].tasks.push(task);
    }
    for (const k of Object.keys(out)) {
      out[k].tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.position - b.position;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTasks, tags, tagOverrides]);

  const groupOrder = [...tags.map((t) => t.id), NEUTRAL.id];

  // Drag — supports moving a single note OR an entire stacked group.
  // When the dragged note is part of a stacked group, we move the BASE position
  // (the first member's position), and apply the same delta to every member's
  // saved position so everything travels together.
  const dragRef = useRef<{
    id: number;
    offX: number; // cursor offset within the dragged note
    offY: number;
    stackTagId: string | null; // when non-null, drag the whole stack
    stackBaseId: number | null; // id of the stack's base (first) task
    stackIndex: number; // dragged note's position inside the stack (0 = base)
    memberDeltas: Array<{ id: number; dx: number; dy: number }> | null; // for stacked drag
    moved: boolean;
  } | null>(null);

  // Drop the dragged task(s) into the recycle bin: snapshot to local trash,
  // drop their saved positions, then call the parent's delete handler.
  const sendToTrash = (taskIds: number[]) => {
    const items: TrashItem[] = taskIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is BoardTask => !!t)
      .map((t) => ({
        id: t.id,
        text: t.text,
        note: t.note,
        createdAt: t.createdAt,
        deletedAt: new Date().toISOString(),
      }));
    if (items.length === 0) return;
    setTrash((prev) => ({
      date: todayKey(),
      items: [...items, ...prev.items],
    }));
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of taskIds) delete next[String(id)];
      return next;
    });
    for (const id of taskIds) onDelete(id);
  };

  // Drop the dragged task(s) into the completed folder: drop saved positions
  // (so on restore they get auto-laid-out fresh) and toggle them done.
  const sendToCompleted = (taskIds: number[]) => {
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of taskIds) delete next[String(id)];
      return next;
    });
    for (const id of taskIds) {
      const t = tasks.find((x) => x.id === id);
      if (t && !t.completed) onToggle(id);
    }
    // Optional celebration effects (sound + confetti) — only fire when the
    // user has actually moved a non-completed task into Completed.
    if (celebrations && taskIds.length > 0) {
      const movedAny = taskIds.some((id) => {
        const t = tasks.find((x) => x.id === id);
        return t && !t.completed;
      });
      if (movedAny) {
        // Fire confetti from the Completed button's centre, in board-local coords.
        if (folderRef.current && boardRef.current) {
          const fr = folderRef.current.getBoundingClientRect();
          const br = boardRef.current.getBoundingClientRect();
          fireConfetti(
            fr.left + fr.width / 2 - br.left,
            fr.top + fr.height / 2 - br.top,
          );
        }
        playCelebrationSound();
      }
    }
  };

  // Restore from completed folder back to the board (toggle off the done flag).
  const restoreFromCompleted = (taskId: number) => {
    const t = tasks.find((x) => x.id === taskId);
    if (t && t.completed) onToggle(taskId);
  };

  // Drop the dragged task(s) into the Posted-for-Future folder. We just clear
  // their saved position and ask the server to flip the postedForFuture flag.
  const sendToPosted = (taskIds: number[]) => {
    if (!onSetPostedForFuture) return;
    setPositions((prev) => {
      const next = { ...prev };
      for (const id of taskIds) delete next[String(id)];
      return next;
    });
    for (const id of taskIds) {
      const t = tasks.find((x) => x.id === id);
      if (t && !t.postedForFuture) onSetPostedForFuture(id, true);
    }
  };

  // Pull a posted note back onto the board.
  const restoreFromPosted = (taskId: number) => {
    if (!onSetPostedForFuture) return;
    const t = tasks.find((x) => x.id === taskId);
    if (t && t.postedForFuture) onSetPostedForFuture(taskId, false);
  };

  // Restore an item from the recycle bin: re-create it via the parent's
  // create handler (the original task was deleted from the backend) and
  // remove the snapshot from local trash.
  const restoreFromBin = (item: TrashItem) => {
    if (!onRestore) return;
    onRestore(item.text, item.note);
    setTrash((prev) => ({
      ...prev,
      items: prev.items.filter(
        (t) => !(t.id === item.id && t.deletedAt === item.deletedAt),
      ),
    }));
  };

  // Keep latest drop handlers reachable from the global mouse listener
  // (which captures closures only once on mount).
  const dropHandlersRef = useRef({ sendToTrash, sendToCompleted, sendToPosted });
  useEffect(() => {
    dropHandlersRef.current = { sendToTrash, sendToCompleted, sendToPosted };
  });

  // Mirror snap-to-grid into a ref so the long-lived mousemove listener
  // always sees the current value without re-binding the effect.
  const snapRef = useRef(snap);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  useEffect(() => {
    // Generous "magnet" zone around the bin / completed buttons so the user
    // doesn't have to land the cursor exactly on the icon. Anything within
    // this radius (in px) of the button's edge counts as a hover/drop.
    const MAGNET_PX = 90;
    const inRect = (
      el: HTMLElement | null,
      x: number,
      y: number,
      magnet = MAGNET_PX,
    ) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return (
        x >= r.left - magnet &&
        x <= r.right + magnet &&
        y >= r.top - magnet &&
        y <= r.bottom + magnet
      );
    };
    const onMove = (e: MouseEvent) => {
      try {
        const drag = dragRef.current;
        const board = boardRef.current;
        if (!drag || !board) return;
        drag.moved = true;
        const rect = board.getBoundingClientRect();
        const rawX = e.clientX - rect.left - drag.offX;
        const rawY = e.clientY - rect.top - drag.offY;
        if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;
        const W = rect.width;
        const maxX = Math.max(PAD, W - NOTE_W - PAD);
        let x = Math.min(Math.max(PAD, rawX), maxX);
        let y = Math.max(PAD, rawY);
        // Snap-to-grid pulls the dragged note onto the nearest grid intersection.
        if (snapRef.current) {
          const snapped = snapToGrid({ x, y });
          x = Math.min(Math.max(PAD, snapped.x), maxX);
          y = Math.max(PAD, snapped.y);
        }

        // Hover detection over the bin / completed / posted folders.
        const overBin = inRect(binRef.current, e.clientX, e.clientY);
        const overFolder = inRect(folderRef.current, e.clientX, e.clientY);
        const overPosted = inRect(postedRef.current, e.clientX, e.clientY);
        const hover: null | "bin" | "folder" | "posted" = overBin
          ? "bin"
          : overFolder
          ? "folder"
          : overPosted
          ? "posted"
          : null;
        setDropHover((prev) => (prev === hover ? prev : hover));

        setPositions((prev) => {
          if (drag.stackTagId && drag.stackBaseId !== null && drag.memberDeltas) {
            // Move the entire stack as one unit. The dragged note follows the
            // cursor; all other members shift by the same delta from the base.
            const baseNewX = x - drag.stackIndex * 6;
            const baseNewY = y - drag.stackIndex * 4;
            const next = { ...prev };
            for (const m of drag.memberDeltas) {
              const cur = prev[String(m.id)] ?? { x: PAD, y: PAD, rot: 0 };
              next[String(m.id)] = {
                x: Math.min(Math.max(PAD, baseNewX + m.dx), maxX),
                y: Math.max(PAD, baseNewY + m.dy),
                rot: Number.isFinite(cur.rot) ? cur.rot : 0,
              };
            }
            return next;
          }
          const key = String(drag.id);
          const cur = prev[key] ?? { x: PAD, y: PAD, rot: 0 };
          return {
            ...prev,
            [key]: {
              x,
              y,
              rot: Number.isFinite(cur.rot) ? cur.rot : 0,
            },
          };
        });
      } catch {
        dragRef.current = null;
        setDraggingId(null);
        setDropHover(null);
        document.body.style.userSelect = "";
      }
    };
    const onUp = (e: MouseEvent) => {
      try {
        const drag = dragRef.current;
        if (drag) {
          const overBin = inRect(binRef.current, e.clientX, e.clientY);
          const overFolder = inRect(folderRef.current, e.clientX, e.clientY);
          const overPosted = inRect(postedRef.current, e.clientX, e.clientY);
          if (overBin || overFolder || overPosted) {
            const ids: number[] =
              drag.stackTagId && drag.memberDeltas
                ? drag.memberDeltas.map((m) => m.id)
                : [drag.id];
            if (overBin) dropHandlersRef.current.sendToTrash(ids);
            else if (overPosted) dropHandlersRef.current.sendToPosted(ids);
            else dropHandlersRef.current.sendToCompleted(ids);
          }
        }
      } catch {}
      dragRef.current = null;
      setDraggingId(null);
      setDropHover(null);
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", () => {
      dragRef.current = null;
      setDraggingId(null);
      setDropHover(null);
      document.body.style.userSelect = "";
    });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent, taskId: number) => {
    if (isSubmitted) return;
    if (!boardRef.current) return;
    if (e.button !== 0) return; // only main mouse button
    try {
      const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const offX = e.clientX - target.left;
      const offY = e.clientY - target.top;
      if (!Number.isFinite(offX) || !Number.isFinite(offY)) return;

      // If this note belongs to a stacked group, prepare to move the whole
      // stack together. Otherwise it's a normal single-note drag.
      const task = tasks.find((t) => t.id === taskId);
      let stackTagId: string | null = null;
      let stackBaseId: number | null = null;
      let stackIndex = 0;
      let memberDeltas: Array<{ id: number; dx: number; dy: number }> | null = null;

      if (task) {
        const tag = getTagFor(task);
        const groupTasks = grouped[tag.id]?.tasks ?? [];
        if (stackedGroups[tag.id] && groupTasks.length > 1) {
          stackTagId = tag.id;
          const baseTask = groupTasks[0];
          stackBaseId = baseTask.id;
          stackIndex = Math.max(0, groupTasks.findIndex((t) => t.id === taskId));
          const basePos = positions[String(baseTask.id)] ?? { x: PAD, y: PAD, rot: 0 };
          memberDeltas = groupTasks.map((t, ix) => {
            const own = positions[String(t.id)];
            // For stacked notes the visual position is base + stackOffset; if a
            // member's own position drifted, fall back to the canonical offset.
            const dx = own ? own.x - basePos.x : ix * 6;
            const dy = own ? own.y - basePos.y : ix * 4;
            return { id: t.id, dx, dy };
          });
        }
      }

      dragRef.current = {
        id: taskId,
        offX,
        offY,
        stackTagId,
        stackBaseId,
        stackIndex,
        memberDeltas,
        moved: false,
      };
      setDraggingId(taskId);
      document.body.style.userSelect = "none";
    } catch {
      dragRef.current = null;
      setDraggingId(null);
    }
  };

  const toggleStack = (tagId: string) =>
    setStackedGroups((prev) => ({ ...prev, [tagId]: !prev[tagId] }));

  const restackGroup = (tagId: string) => {
    const group = grouped[tagId];
    if (!group) return;
    const baseId = String(group.tasks[0]?.id);
    const base = positions[baseId] ?? clampPos({ x: PAD, y: PAD, rot: 0 }, boardWidth);
    setPositions((prev) => {
      const next = { ...prev };
      group.tasks.forEach((t, ix) => {
        next[String(t.id)] = clampPos(
          { x: base.x + ix * 6, y: base.y + ix * 4, rot: 0 },
          boardWidth,
        );
      });
      return next;
    });
  };

  // Fan a stacked group out into the board, avoiding overlap with everything else.
  const fanGroup = (tagId: string) => {
    const group = grouped[tagId];
    if (!group) return;
    const groupIds = new Set(group.tasks.map((t) => String(t.id)));

    setPositions((prev) => {
      const next = { ...prev };
      // Occupied = every other note's current position.
      const occupied: Array<{ x: number; y: number }> = Object.entries(next)
        .filter(([k]) => !groupIds.has(k))
        .map(([, p]) => ({ x: p.x, y: p.y }));

      group.tasks.forEach((t) => {
        const slot = findFreeSlot(occupied, boardWidth);
        next[String(t.id)] = slot;
        occupied.push({ x: slot.x, y: slot.y });
      });
      return next;
    });
  };

  // Tidy: clear stacks, then arrange every task in clean tag-grouped rows
  // with no overlap, growing downward as needed. We feed in each note's
  // actual rendered height so rows pack tightly instead of leaving the
  // big blank bands the user complained about.
  const tidyBoard = () => {
    const fresh = autoLayout(tasks, tags, boardWidth, noteHeightsRef.current, tagOverrides);
    setPositions(() => {
      const next: Record<string, Pos> = {};
      for (const t of tasks) {
        const id = String(t.id);
        next[id] = fresh[t.id] ?? { x: PAD, y: PAD, rot: 0 };
      }
      return next;
    });
    setStackedGroups({});
    // Scroll back to the top so the user sees the freshly tidied layout.
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Allow the parent (app.tsx) to trigger Tidy from a keyboard shortcut by
  // bumping a counter. We skip the very first run so just mounting doesn't
  // shuffle the user's saved layout.
  const tidyMountRef = useRef(true);
  useEffect(() => {
    if (tidyTrigger === undefined) return;
    if (tidyMountRef.current) {
      tidyMountRef.current = false;
      return;
    }
    tidyBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tidyTrigger]);

  // Esc closes any open board panels (tag editor, completed folder, bin,
  // open note editor) — the parent handles its own panels separately.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setBinOpen(false);
      setFolderOpen(false);
      setPostedOpen(false);
      setShowTagPanel(false);
      setOpenNoteFor(null);
      setEditingTextFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addTag = () => {
    if (!newTagName.trim()) return;
    const palette = PALETTE.find((p) => p.swatch === newTagSwatch) ?? PALETTE[0];
    const id = `t-${Date.now()}`;
    setTags((prev) => [
      ...prev,
      {
        id,
        name: newTagName.trim(),
        keyword: (newTagKeyword || newTagName).trim().toLowerCase(),
        ...palette,
      },
    ]);
    setNewTagName("");
    setNewTagKeyword("");
    setShowTagPanel(false);
  };

  const removeTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setStackedGroups((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  };

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col rounded-3xl border overflow-hidden shadow-[0_30px_80px_-50px_rgba(31,27,20,0.45)] ${
        darkMode ? "border-[#3a3530]" : "border-[#E2DBC6]"
      }`}
      style={{
        background: darkMode
          ? "radial-gradient(900px 500px at 90% 0%, rgba(124,58,237,0.18) 0%, transparent 55%), linear-gradient(180deg, #1A1714 0%, #14110F 100%)"
          : "radial-gradient(900px 500px at 90% 0%, #F0EAFB 0%, transparent 55%), linear-gradient(180deg, #F6F1E4 0%, #EFE8D5 100%)",
      }}
    >
      {/* Tag bar */}
      {!hideToolbar && (
      <div
        className={`px-4 lg:px-5 pt-3 pb-2 flex items-center gap-2 flex-wrap border-b ${
          darkMode
            ? "border-[#3a3530]/70 bg-[#1f1c19]/60"
            : "border-[#E2DBC6]/70 bg-white/40"
        }`}
      >
        <span className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-[#6B6452] mr-1">
          <TagIcon size={12} /> Tags
        </span>
        {tags.map((tag) => {
          const count = grouped[tag.id]?.tasks.length ?? 0;
          const stacked = !!stackedGroups[tag.id];
          return (
            <div
              key={tag.id}
              className="group flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-full border bg-white/85 backdrop-blur shadow-sm"
              style={{ borderColor: tag.border }}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: tag.swatch }}
              >
                {count}
              </span>
              <span className="text-sm font-medium" style={{ color: tag.ink }}>
                {tag.name}
              </span>
              {count > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    stacked
                      ? (toggleStack(tag.id), fanGroup(tag.id))
                      : (toggleStack(tag.id), restackGroup(tag.id))
                  }
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-white"
                  style={{ background: tag.ribbon }}
                >
                  {stacked ? (
                    <>
                      <LayoutGrid size={10} /> Unstack
                    </>
                  ) : (
                    <>
                      <Layers size={10} /> Stack
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => removeTag(tag.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[#9A9279] hover:text-[#1F1B14]"
                aria-label={`Remove ${tag.name}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {grouped[NEUTRAL.id] && (
          <div
            className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border bg-white/85 backdrop-blur shadow-sm"
            style={{ borderColor: NEUTRAL.border }}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: NEUTRAL.swatch }}
            >
              {grouped[NEUTRAL.id].tasks.length}
            </span>
            <span className="text-sm font-medium" style={{ color: NEUTRAL.ink }}>
              Untagged
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowTagPanel((s) => !s)}
          className="ml-1 flex items-center gap-1 text-xs font-medium text-[#1F1B14] bg-white border border-dashed border-[#C7BFA8] rounded-full px-2.5 py-1 hover:bg-[#FBF7EE]"
        >
          <Plus size={12} /> New tag
        </button>

        <button
          type="button"
          onClick={() => setSnap((s) => !s)}
          className={`ml-auto flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 border shadow-sm transition-colors ${
            snap
              ? "bg-[#1F1B14] text-white border-[#1F1B14]"
              : darkMode
                ? "bg-[#2a2520] text-[#E5E0D6] border-[#3a3530] hover:bg-[#332d28]"
                : "bg-white text-[#1F1B14] border-[#E2DBC6] hover:bg-[#FBF7EE]"
          }`}
          title={snap ? "Snap-to-grid: ON — click to free-drag" : "Snap-to-grid: OFF — click to align notes to a grid"}
        >
          <Magnet size={12} /> {snap ? "Snap on" : "Snap"}
        </button>

        <button
          type="button"
          onClick={tidyBoard}
          className={`flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 border shadow-sm ${
            darkMode
              ? "text-[#E5E0D6] bg-[#2a2520] border-[#3a3530] hover:bg-[#332d28]"
              : "text-[#1F1B14] bg-white border-[#E2DBC6] hover:bg-[#FBF7EE]"
          }`}
          title="Re-arrange notes neatly inside the board"
        >
          <LayoutGrid size={12} /> Tidy board
        </button>
      </div>
      )}

      {showTagPanel && !hideToolbar && (
        <div className="mx-4 mt-3 rounded-2xl bg-white border border-[#E2DBC6] shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-[#1F1B14]">Create a tag</div>
              <div className="text-xs text-[#6B6452]">
                Tasks whose title contains the keyword get auto-grouped & color-coded.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowTagPanel(false)}
              className="text-[#9A9279] hover:text-[#1F1B14]"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-12 gap-3">
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Tag name (e.g. Client Change)"
              className="col-span-4 px-3 py-2 rounded-lg border border-[#E2DBC6] bg-[#FBF7EE] text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <input
              value={newTagKeyword}
              onChange={(e) => setNewTagKeyword(e.target.value)}
              placeholder="Match keyword (defaults to tag name)"
              className="col-span-4 px-3 py-2 rounded-lg border border-[#E2DBC6] bg-[#FBF7EE] text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <div className="col-span-3 flex items-center gap-1.5 flex-wrap">
              {PALETTE.map((p) => (
                <button
                  type="button"
                  key={p.swatch}
                  onClick={() => setNewTagSwatch(p.swatch)}
                  className="w-6 h-6 rounded-full flex items-center justify-center border-2"
                  style={{
                    background: p.swatch,
                    borderColor: newTagSwatch === p.swatch ? "#1F1B14" : "transparent",
                  }}
                >
                  {newTagSwatch === p.swatch && <Check size={10} className="text-white" />}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={addTag}
              className="col-span-1 bg-[#1F1B14] text-white text-sm font-medium rounded-lg px-3 py-2"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Board surface — vertically scrollable. Inner canvas grows to fit notes. */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          className={`absolute inset-0 m-3 rounded-2xl border overflow-y-auto overflow-x-hidden ${
            darkMode ? "border-[#3a3530]" : "border-[#E2DBC6]"
          }`}
          style={{
            background: darkMode
              ? "repeating-linear-gradient(0deg, transparent 0 39px, rgba(255,255,255,0.035) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(255,255,255,0.035) 39px 40px), #1A1714"
              : "repeating-linear-gradient(0deg, transparent 0 39px, rgba(31,27,20,0.04) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(31,27,20,0.04) 39px 40px), #FBF7EE",
            boxShadow: darkMode
              ? "0 1px 0 rgba(255,255,255,.04) inset"
              : "0 1px 0 rgba(255,255,255,.7) inset",
          }}
        >
          <div
            ref={boardRef}
            className="relative w-full"
            style={{
              minHeight: (() => {
                // Make the canvas tall enough to hold every note + a buffer so
                // the user can drag/scroll comfortably below the lowest note.
                let maxY = 0;
                for (const t of tasks) {
                  const p = positions[String(t.id)];
                  if (p && p.y > maxY) maxY = p.y;
                }
                return Math.max(560, maxY + NOTE_H + 120);
              })(),
            }}
          >
            {/* Empty / no-results state */}
            {visibleTasks.length === 0 && (
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center ${
                  darkMode ? "text-[#9A9279]" : "text-[#6B6452]"
                }`}
              >
                <Layers className="w-8 h-8 opacity-40 mb-2" />
                <p className="text-sm">No tasks match the current filter.</p>
              </div>
            )}

            {/* Confetti bursts (rendered above notes) */}
            {bursts.map((b) => (
              <div
                key={b.id}
                className="absolute pointer-events-none"
                style={{ left: b.x, top: b.y, zIndex: 9999 }}
              >
                {Array.from({ length: 26 }).map((_, i) => {
                  const angle = (i / 26) * Math.PI * 2;
                  const dist = 80 + Math.random() * 80;
                  const cx = Math.cos(angle) * dist;
                  const cy = Math.sin(angle) * dist + 40; // bias downward (gravity)
                  const cr = 360 + Math.random() * 540;
                  const cd = 700 + Math.random() * 600;
                  const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
                  return (
                    <span
                      key={i}
                      className="confetti-piece"
                      style={
                        {
                          background: color,
                          left: 0,
                          top: 0,
                          "--cx": `${cx}px`,
                          "--cy": `${cy}px`,
                          "--cr": `${cr}deg`,
                          "--cd": `${cd}ms`,
                        } as React.CSSProperties
                      }
                    />
                  );
                })}
              </div>
            ))}

            {/* Sticky notes (no surrounding cluster boxes — just the notes) */}
            {tasks.map((task, idx) => {
              if (!visibleIds.has(task.id)) return null;
              const tag = getTagFor(task);
              const groupTasks = grouped[tag.id]?.tasks ?? [task];
              const stacked = !!stackedGroups[tag.id] && groupTasks.length > 1;
              const stackIndex = Math.max(0, groupTasks.findIndex((t) => t.id === task.id));
              const baseTask = groupTasks[0];
              const basePosRaw = positions[String(baseTask.id)] ?? { x: PAD, y: PAD, rot: 0 };
              const basePos = clampPos(basePosRaw, boardWidth);
              const ownPosRaw = positions[String(task.id)] ?? basePos;
              const ownPos = clampPos(ownPosRaw, boardWidth);
              const x = stacked ? basePos.x + stackIndex * 6 : ownPos.x;
              const y = stacked ? basePos.y + stackIndex * 4 : ownPos.y;
              const rot = stacked ? -2 + stackIndex * 1.4 : ownPos.rot;
              const isTopOfStack = stacked && stackIndex === groupTasks.length - 1;

            const days = daysSinceCreated(task.createdAt);
            const dateInfo = formatDateLabel(days, task.createdAt);
            const showNote = openNoteFor === task.id;
            const priority = isPriorityTitle(task.text);
            const noteValue = comments[task.id] ?? task.note ?? "";

            const isMe = draggingId === task.id;
            // Completed notes sink: lower z-index + faded paper.
            const baseZ = task.completed ? 50 : 100;
            return (
              <div
                key={task.id}
                ref={setNoteEl(task.id)}
                onMouseDown={(e) => startDrag(e, task.id)}
                className={`absolute select-none group/note ${
                  isSubmitted ? "cursor-default" : "cursor-grab active:cursor-grabbing"
                }`}
                style={{
                  left: x,
                  top: y,
                  width: NOTE_W,
                  transform: `rotate(${rot}deg)`,
                  transition: isMe
                    ? "none"
                    : "transform .25s ease, left .35s ease, top .35s ease, opacity .2s ease",
                  zIndex:
                    baseZ +
                    idx +
                    (isTopOfStack ? 50 : 0) +
                    (isMe ? 10000 : 0),
                  opacity: task.completed ? 0.7 : 1,
                  filter: stacked && !isTopOfStack ? "saturate(0.92)" : "none",
                }}
              >
                <div
                  className="relative rounded-[14px] p-4 pb-4 overflow-hidden"
                  style={{
                    background: tag.paper,
                    borderTop: `4px solid ${tag.ribbon}`,
                    boxShadow: isMe
                      ? "0 1px 0 rgba(255,255,255,.7) inset, 0 24px 40px -12px rgba(31,27,20,.45), 0 4px 8px rgba(31,27,20,.12)"
                      : "0 1px 0 rgba(255,255,255,.7) inset, 0 12px 22px -10px rgba(31,27,20,.35), 0 2px 4px rgba(31,27,20,.08)",
                    color: tag.ink,
                    outline: dateInfo.stale && !task.completed ? "2px solid rgba(245,158,11,.55)" : "none",
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1 flex-wrap relative">
                      <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenTagPickerFor((cur) => (cur === task.id ? null : task.id));
                        }}
                        title="Change tag"
                        className="text-[10px] uppercase tracking-[0.18em] font-semibold pl-1.5 pr-1 py-0.5 rounded inline-flex items-center gap-1 hover:brightness-95"
                        style={{ background: "rgba(255,255,255,0.55)", color: tag.ink }}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: tag.swatch ?? tag.ribbon }}
                        />
                        {tag.name}
                        <span className="opacity-60 text-[8px]">▾</span>
                      </button>
                      {priority && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded text-white"
                          style={{ background: "#DC2626" }}
                        >
                          <Zap size={10} /> Priority
                        </span>
                      )}
                      {openTagPickerFor === task.id && (
                        <div
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute z-50 top-full left-0 mt-1 w-[180px] rounded-lg shadow-xl border border-[#E2DBC6] bg-white p-1.5"
                          style={{ color: "#1F1B14" }}
                        >
                          <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-[#7A6F58] px-1.5 pb-1">
                            Assign tag
                          </div>
                          {/* The tag list can grow long once users define many
                              custom tags; cap the height and scroll internally
                              so every tag is reachable. */}
                          <div className="max-h-[260px] overflow-y-auto pr-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTagFor(task.id, null);
                              setOpenTagPickerFor(null);
                            }}
                            className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-[#FBF5E5] flex items-center gap-2"
                          >
                            <span className="inline-block w-2 h-2 rounded-full bg-[#94A3B8]" />
                            <span className="flex-1">Auto (by keyword)</span>
                            {!tagOverrides[String(task.id)] && (
                              <Check size={11} className="text-[#7A6F58]" />
                            )}
                          </button>
                          <div className="my-1 h-px bg-[#E2DBC6]" />
                          {tags.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTagFor(task.id, t.id);
                                setOpenTagPickerFor(null);
                              }}
                              className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-[#FBF5E5] flex items-center gap-2"
                            >
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ background: t.swatch }}
                              />
                              <span className="flex-1">{t.name}</span>
                              {tagOverrides[String(task.id)] === t.id && (
                                <Check size={11} className="text-[#7A6F58]" />
                              )}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTagFor(task.id, NEUTRAL.id);
                              setOpenTagPickerFor(null);
                            }}
                            className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-[#FBF5E5] flex items-center gap-2"
                          >
                            <span className="inline-block w-2 h-2 rounded-full bg-[#94A3B8]" />
                            <span className="flex-1">Untagged</span>
                            {tagOverrides[String(task.id)] === NEUTRAL.id && (
                              <Check size={11} className="text-[#7A6F58]" />
                            )}
                          </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <GripVertical size={13} className="opacity-40" />
                  </div>

                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
                      disabled={isSubmitted}
                      className="mt-0.5 shrink-0 disabled:cursor-not-allowed"
                      aria-label="Toggle done"
                    >
                      {task.completed ? (
                        <CheckCircle2 size={18} style={{ color: tag.ribbon }} />
                      ) : (
                        <Circle size={18} className="opacity-50" />
                      )}
                    </button>
                    {editingTextFor === task.id ? (
                      <div
                        onMouseDown={(e) => e.stopPropagation()}
                        className="min-w-0 flex-1"
                      >
                        <textarea
                          autoFocus
                          value={editTextDraft}
                          onChange={(e) => setEditTextDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              const next = editTextDraft.trim();
                              if (next && next !== task.text && onTextChange) {
                                onTextChange(task.id, next);
                              }
                              setEditingTextFor(null);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingTextFor(null);
                            }
                          }}
                          onBlur={() => {
                            const next = editTextDraft.trim();
                            if (next && next !== task.text && onTextChange) {
                              onTextChange(task.id, next);
                            }
                            setEditingTextFor(null);
                          }}
                          rows={Math.min(4, Math.max(1, editTextDraft.split("\n").length))}
                          className="w-full text-[15px] font-semibold leading-snug tracking-tight bg-white/90 border border-[#E2DBC6] rounded-md px-2 py-1 resize-none focus:outline-none focus:ring-2 focus:ring-black/10"
                          style={{
                            fontFamily: "'Space Grotesk', Inter, sans-serif",
                            color: tag.ink,
                          }}
                        />
                        <div className="mt-1 text-[10px] text-[#6B6452]">
                          Enter to save · Esc to cancel
                        </div>
                      </div>
                    ) : (
                      <h3
                        className={`text-[15px] font-semibold leading-snug tracking-tight min-w-0 flex-1 break-words ${
                          isSubmitted || !onTextChange ? "" : "cursor-text hover:bg-white/40 rounded-md px-1 -mx-1"
                        }`}
                        style={{
                          fontFamily: "'Space Grotesk', Inter, sans-serif",
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                        }}
                        title={
                          isSubmitted || !onTextChange
                            ? undefined
                            : "Double-click to edit"
                        }
                        onDoubleClick={(e) => {
                          if (isSubmitted || !onTextChange) return;
                          e.stopPropagation();
                          setEditTextDraft(task.text);
                          setEditingTextFor(task.id);
                        }}
                        onMouseDown={(e) => {
                          // Prevent the parent's drag handler from grabbing
                          // the title — otherwise the text isn't selectable.
                          if (!isSubmitted && onTextChange) e.stopPropagation();
                        }}
                      >
                        {task.completed ? (
                          <span className="line-through opacity-60">
                            {trimmedQuery && searchMode === "name" ? (
                              <HighlightedText text={task.text} query={trimmedQuery} />
                            ) : (
                              task.text
                            )}
                          </span>
                        ) : trimmedQuery && searchMode === "name" ? (
                          <HighlightedText text={task.text} query={trimmedQuery} />
                        ) : (
                          task.text
                        )}
                        {!isSubmitted && onTextChange && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTextDraft(task.text);
                              setEditingTextFor(task.id);
                            }}
                            title="Edit task text"
                            aria-label="Edit task text"
                            className="ml-1.5 inline-flex items-center align-middle opacity-0 group-hover/note:opacity-60 hover:!opacity-100 transition-opacity"
                          >
                            <Pencil size={11} />
                          </button>
                        )}
                      </h3>
                    )}
                  </div>

                  <div className="mt-2 ml-6 flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded ${
                        dateInfo.stale && !task.completed
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : dateInfo.isPending
                          ? "bg-white/70 text-[#6B6452] border border-white/70"
                          : "bg-white/70 text-[#6B6452]"
                      }`}
                    >
                      {dateInfo.isPending ? <Calendar size={10} /> : <Clock size={10} />}
                      {dateInfo.label}
                    </span>
                    {dateInfo.isPending && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          dateInfo.stale && !task.completed
                            ? "bg-amber-500 text-white"
                            : "bg-[#1F1B14]/85 text-white"
                        }`}
                      >
                        {dateInfo.daysAgo}d
                      </span>
                    )}
                    {dateInfo.stale && !task.completed && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800">
                        <Flame size={10} /> stale
                      </span>
                    )}
                  </div>

                  {noteValue && !showNote && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isSubmitted) setOpenNoteFor(task.id);
                      }}
                      title={isSubmitted ? "Note (read-only)" : "Click to edit note"}
                      disabled={isSubmitted}
                      className="mt-2 ml-6 w-[calc(100%-1.5rem)] text-left flex items-start gap-1.5 text-[12px] italic opacity-80 hover:opacity-100 border-l-2 pl-2 rounded-sm hover:bg-white/40 disabled:cursor-default"
                      style={{ borderColor: tag.ribbon }}
                    >
                      <MessageSquare size={11} className="mt-0.5 shrink-0" />
                      <span className="break-words">{noteValue}</span>
                    </button>
                  )}

                  {showNote && (
                    <div onMouseDown={(e) => e.stopPropagation()} className="mt-2 ml-6">
                      <textarea
                        value={noteValue}
                        onChange={(e) => onNoteChange(task.id, e.target.value)}
                        onBlur={(e) => onNoteBlur(task.id, e.target.value)}
                        placeholder="Add a quick note…"
                        readOnly={isSubmitted}
                        className="w-full min-h-[64px] text-[12px] p-2 rounded-md bg-white/80 border border-white/90 focus:outline-none focus:ring-2 focus:ring-black/10 resize-y"
                        style={{ color: tag.ink }}
                      />
                      <div className="mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenNoteFor(null);
                          }}
                          className="text-[11px] font-medium px-2 py-0.5 rounded text-white"
                          style={{ background: tag.ribbon }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    className="mt-2 ml-6 flex items-center gap-1 opacity-70 group-hover/note:opacity-100 transition-opacity"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenNoteFor(showNote ? null : task.id);
                      }}
                      className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded hover:bg-white/70"
                      title={noteValue ? "Edit note" : "Add note"}
                    >
                      <MessageSquare size={11} /> {noteValue ? "Edit" : "Note"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopy(task.text);
                      }}
                      className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded hover:bg-white/70"
                      title="Copy text"
                    >
                      <Copy size={11} /> Copy
                    </button>
                    {!isSubmitted && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(task.id);
                        }}
                        className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded hover:bg-white/70 text-[#7A1B1B]"
                        title="Delete task"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    )}
                  </div>

                  <div
                    className="absolute bottom-0 right-0 w-7 h-7 rounded-tl-xl rounded-br-[14px] pointer-events-none"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(0,0,0,0) 50%, rgba(31,27,20,.10) 50%, rgba(31,27,20,.18) 100%)",
                    }}
                  />

                  {isTopOfStack && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStack(tag.id);
                        fanGroup(tag.id);
                      }}
                      title={`${groupTasks.length} notes stacked — click to fan out`}
                      aria-label={`${groupTasks.length} stacked notes — fan out`}
                      // High-contrast badge: solid ribbon-colour fill with
                      // white text + ring so it pops off any sticky-note
                      // background. Bigger than before so the count is
                      // readable at a glance even when many stacks share
                      // the board.
                      className="absolute -top-3.5 -right-3.5 rounded-full min-w-[2.6rem] h-10 px-2.5 inline-flex items-center justify-center gap-1 shadow-lg leading-none ring-2 ring-white text-white"
                      style={{
                        background: tag.ribbon,
                        boxShadow:
                          "0 6px 14px -4px rgba(0,0,0,.35), 0 0 0 2px #ffffff",
                      }}
                    >
                      <Layers size={14} className="text-white" />
                      <span className="text-base font-extrabold tabular-nums text-white">
                        {groupTasks.length}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>

        {/* Pinned drop targets — they sit on top of the scroll container so
            they stay in the same place as the user scrolls the board. */}
        <button
          ref={folderRef}
          type="button"
          onClick={() => { setFolderOpen((s) => !s); setBinOpen(false); setPostedOpen(false); }}
          title="Completed — drag a note here to mark it done"
          className="absolute top-6 right-6 z-[200] flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-full backdrop-blur border-2 shadow-lg transition-all"
          style={{
            borderColor: dropHover === "folder"
              ? "#059669"
              : darkMode ? "#0d6b4a" : "#A7F3D0",
            background: dropHover === "folder"
              ? darkMode ? "#0a3a26" : "#DCFCE7"
              : darkMode ? "rgba(31,27,20,0.92)" : "rgba(255,255,255,0.95)",
            transform: dropHover === "folder" ? "scale(1.08)" : "scale(1)",
            boxShadow: dropHover === "folder"
              ? "0 14px 28px -8px rgba(5,150,105,.45), 0 0 0 4px rgba(16,185,129,.18)"
              : "0 8px 18px -8px rgba(31,27,20,.35)",
          }}
        >
          <FolderCheck size={18} style={{ color: darkMode ? "#34D399" : "#059669" }} />
          <span
            className="text-[13px] font-semibold"
            style={{ color: darkMode ? "#A7F3D0" : "#064E3B" }}
          >
            Completed
          </span>
          {completedCount > 0 && (
            <span
              className="text-[11px] font-bold text-white rounded-full px-1.5 min-w-[20px] text-center"
              style={{ background: "#059669" }}
            >
              {completedCount}
            </span>
          )}
        </button>

        {/* "Posted for Future" folder — vertically centred on the right edge,
            mirroring the position the user asked for. Drop a note here and it
            disappears from today's board, gets reported in tonight's email,
            and is intentionally NOT carried into tomorrow. */}
        <button
          ref={postedRef}
          type="button"
          onClick={() => { setPostedOpen((s) => !s); setFolderOpen(false); setBinOpen(false); }}
          title="Posted for Future — drag a note here to mark it shipped today (won't carry forward, will appear in tonight's email)"
          className="absolute top-1/2 right-6 -translate-y-1/2 z-[200] flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-full backdrop-blur border-2 shadow-lg transition-all"
          style={{
            borderColor: dropHover === "posted"
              ? "#1D4ED8"
              : darkMode ? "#1e3a8a" : "#BFDBFE",
            background: dropHover === "posted"
              ? darkMode ? "#172554" : "#DBEAFE"
              : darkMode ? "rgba(31,27,20,0.92)" : "rgba(255,255,255,0.95)",
            transform: dropHover === "posted" ? "scale(1.08)" : "scale(1)",
            boxShadow: dropHover === "posted"
              ? "0 14px 28px -8px rgba(29,78,216,.45), 0 0 0 4px rgba(59,130,246,.18)"
              : "0 8px 18px -8px rgba(31,27,20,.35)",
          }}
        >
          <Send size={18} style={{ color: darkMode ? "#93C5FD" : "#1D4ED8" }} />
          <span
            className="text-[13px] font-semibold"
            style={{ color: darkMode ? "#BFDBFE" : "#1E3A8A" }}
          >
            Posted for Future
          </span>
          {postedCount > 0 && (
            <span
              className="text-[11px] font-bold text-white rounded-full px-1.5 min-w-[20px] text-center"
              style={{ background: "#1D4ED8" }}
            >
              {postedCount}
            </span>
          )}
        </button>

        <button
          ref={binRef}
          type="button"
          onClick={() => { setBinOpen((s) => !s); setFolderOpen(false); setPostedOpen(false); }}
          title="Recycle bin — drag a note here to delete it (clears every day)"
          className="absolute bottom-6 right-6 z-[200] flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-full bg-white/95 backdrop-blur border-2 shadow-lg transition-all"
          style={{
            borderColor: dropHover === "bin" ? "#DC2626" : "#FBCABA",
            background: dropHover === "bin" ? "#FEE2E2" : "rgba(255,255,255,0.95)",
            transform: dropHover === "bin" ? "scale(1.08)" : "scale(1)",
            boxShadow: dropHover === "bin"
              ? "0 14px 28px -8px rgba(220,38,38,.45), 0 0 0 4px rgba(239,68,68,.18)"
              : "0 8px 18px -8px rgba(31,27,20,.35)",
          }}
        >
          <Trash2 size={18} style={{ color: "#DC2626" }} />
          <span className="text-[13px] font-semibold text-[#7A1B1B]">Bin</span>
          {trash.items.length > 0 && (
            <span
              className="text-[11px] font-bold text-white rounded-full px-1.5 min-w-[20px] text-center"
              style={{ background: "#DC2626" }}
            >
              {trash.items.length}
            </span>
          )}
        </button>

        {/* Completed panel */}
        {folderOpen && (
          <div
            className={`absolute top-20 right-6 z-[300] w-[320px] max-h-[60vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
              darkMode ? "bg-[#1f1c19] border-[#0d6b4a]" : "bg-white border-[#A7F3D0]"
            }`}
            style={{ boxShadow: "0 30px 60px -20px rgba(5,150,105,.35)" }}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                darkMode
                  ? "border-[#3a3530] bg-[#0a3a26]/40"
                  : "border-[#E2DBC6] bg-[#ECFDF5]"
              }`}
            >
              <div className="flex items-center gap-2">
                <FolderCheck size={16} style={{ color: darkMode ? "#34D399" : "#059669" }} />
                <span
                  className="text-sm font-semibold"
                  style={{ color: darkMode ? "#A7F3D0" : "#064E3B" }}
                >
                  Completed ({completedTasks.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFolderOpen(false)}
                className={darkMode ? "text-[#9A9279] hover:text-white" : "text-[#6B6452] hover:text-[#1F1B14]"}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {completedTasks.length === 0 ? (
                <div className={`text-center text-xs py-8 px-3 ${darkMode ? "text-[#7a7464]" : "text-[#6B6452]"}`}>
                  Nothing here yet. Drag any note onto the Completed button to file it away.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {completedTasks.map((t) => (
                    <li
                      key={t.id}
                      className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg border border-transparent ${
                        darkMode
                          ? "hover:bg-[#0a3a26]/40 hover:border-[#0d6b4a]"
                          : "hover:bg-[#F0FDF4] hover:border-[#A7F3D0]"
                      }`}
                    >
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: darkMode ? "#34D399" : "#059669" }} />
                      <span
                        className={`flex-1 text-[12.5px] line-through opacity-70 break-words ${
                          darkMode ? "text-[#E5E0D6]" : "text-[#1F1B14]"
                        }`}
                        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                      >
                        {t.text}
                      </span>
                      {!isSubmitted && (
                        <button
                          type="button"
                          onClick={() => restoreFromCompleted(t.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-1 rounded text-white shrink-0"
                          style={{ background: "#059669" }}
                          title="Restore to board"
                        >
                          <RotateCcw size={11} /> Restore
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Posted-for-Future panel */}
        {postedOpen && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 right-6 z-[300] w-[340px] max-h-[60vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
              darkMode ? "bg-[#1f1c19] border-[#1e3a8a]" : "bg-white border-[#BFDBFE]"
            }`}
            style={{ boxShadow: "0 30px 60px -20px rgba(29,78,216,.35)" }}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                darkMode
                  ? "border-[#3a3530] bg-[#172554]/60"
                  : "border-[#E2DBC6] bg-[#EFF6FF]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Send size={16} style={{ color: darkMode ? "#93C5FD" : "#1D4ED8" }} />
                <span
                  className="text-sm font-semibold"
                  style={{ color: darkMode ? "#BFDBFE" : "#1E3A8A" }}
                >
                  Posted for Future ({postedTasks.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPostedOpen(false)}
                className={darkMode ? "text-[#9A9279] hover:text-white" : "text-[#6B6452] hover:text-[#1F1B14]"}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div
              className={`px-4 py-2 text-[11px] border-b ${
                darkMode
                  ? "text-[#BFDBFE] bg-[#172554]/40 border-[#1e3a8a]"
                  : "text-[#1E3A8A] bg-[#EFF6FF]/60 border-[#BFDBFE]"
              }`}
            >
              Reported in tonight's email · won't carry into tomorrow.
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {postedTasks.length === 0 ? (
                <div className={`text-center text-xs py-8 px-3 ${darkMode ? "text-[#7a7464]" : "text-[#6B6452]"}`}>
                  Nothing posted yet. Drag any note onto the Posted for Future button to file it for tonight's report.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {postedTasks.map((t) => (
                    <li
                      key={t.id}
                      className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg border border-transparent ${
                        darkMode
                          ? "hover:bg-[#172554]/40 hover:border-[#1e3a8a]"
                          : "hover:bg-[#EFF6FF] hover:border-[#BFDBFE]"
                      }`}
                    >
                      <Send size={13} className="mt-0.5 shrink-0" style={{ color: darkMode ? "#93C5FD" : "#1D4ED8" }} />
                      <span
                        className={`flex-1 text-[12.5px] break-words ${
                          darkMode ? "text-[#E5E0D6]" : "text-[#1F1B14]"
                        }`}
                        style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                      >
                        {t.text}
                      </span>
                      {!isSubmitted && onSetPostedForFuture && (
                        <button
                          type="button"
                          onClick={() => restoreFromPosted(t.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-1 rounded text-white shrink-0"
                          style={{ background: "#1D4ED8" }}
                          title="Restore to board"
                        >
                          <RotateCcw size={11} /> Restore
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Bin panel */}
        {binOpen && (
          <div
            className={`absolute bottom-20 right-6 z-[300] w-[320px] max-h-[60vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${
              darkMode ? "bg-[#1f1c19] border-[#5a2a2a]" : "bg-white border-[#FBCABA]"
            }`}
            style={{ boxShadow: "0 30px 60px -20px rgba(220,38,38,.35)" }}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${
                darkMode
                  ? "border-[#3a3530] bg-[#3a1f1f]/40"
                  : "border-[#E2DBC6] bg-[#FEF2F2]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Inbox size={16} style={{ color: "#DC2626" }} />
                <span
                  className="text-sm font-semibold"
                  style={{ color: darkMode ? "#FCA5A5" : "#7A1B1B" }}
                >
                  Recycle bin ({trash.items.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setBinOpen(false)}
                className={darkMode ? "text-[#9A9279] hover:text-white" : "text-[#6B6452] hover:text-[#1F1B14]"}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div
              className={`px-4 py-2 text-[11px] border-b ${
                darkMode
                  ? "text-[#FCA5A5] bg-[#3a1f1f]/30 border-[#5a2a2a]"
                  : "text-[#7A1B1B] bg-[#FEF2F2]/60 border-[#FBCABA]"
              }`}
            >
              Bin clears automatically at the end of the day.
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {trash.items.length === 0 ? (
                <div className={`text-center text-xs py-8 px-3 ${darkMode ? "text-[#7a7464]" : "text-[#6B6452]"}`}>
                  No deleted notes today. Drag any note onto the Bin to remove it.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {trash.items.map((t) => {
                    const when = (() => {
                      try {
                        const d = new Date(t.deletedAt);
                        return d.toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        });
                      } catch {
                        return "";
                      }
                    })();
                    return (
                      <li
                        key={`${t.id}-${t.deletedAt}`}
                        className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg border border-transparent ${
                          darkMode
                            ? "hover:bg-[#3a1f1f] hover:border-[#5a2a2a]"
                            : "hover:bg-[#FEF2F2] hover:border-[#FBCABA]"
                        }`}
                      >
                        <Trash2 size={13} className="mt-0.5 shrink-0" style={{ color: "#DC2626" }} />
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-[12.5px] break-words ${
                              darkMode ? "text-[#E5E0D6]" : "text-[#1F1B14]"
                            }`}
                            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                          >
                            {t.text}
                          </div>
                          {when && (
                            <div
                              className={`text-[10px] mt-0.5 ${
                                darkMode ? "text-[#7a7464]" : "text-[#9A9279]"
                              }`}
                            >
                              Deleted at {when}
                            </div>
                          )}
                        </div>
                        {!isSubmitted && onRestore && (
                          <button
                            type="button"
                            onClick={() => restoreFromBin(t)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-1 rounded text-white shrink-0"
                            style={{ background: "#059669" }}
                            title="Restore this note to the board"
                          >
                            <RotateCcw size={11} /> Restore
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <div
        className={`px-5 pb-2 pt-1 text-[11px] flex items-center justify-between flex-wrap gap-2 ${
          darkMode ? "text-[#7a7464]" : "text-[#6B6452]"
        }`}
      >
        <span>Drag a note onto Completed to file it · drag onto Bin to delete · stacks move as one.</span>
        <span className="italic">Scroll the board vertically · positions, tags & stacks are saved on this device.</span>
      </div>
    </div>
  );
}
