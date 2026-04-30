import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Tag as TagIcon,
  Layers,
  LayoutGrid,
  X,
  GripVertical,
  Search,
  Check,
  MessageSquare,
  Copy,
  Trash2,
  Calendar,
  RotateCcw,
  Send,
  Clock,
  Type,
  CalendarDays,
  Flame,
  CheckCircle2,
  Circle,
  Filter,
  Sparkles,
  History,
  Zap,
} from "lucide-react";

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

type Task = {
  id: string;
  title: string;
  body?: string;
  note?: string;
  done?: boolean;
  createdDaysAgo: number;
  x: number;
  y: number;
  rot: number;
};

const INITIAL_TAGS: TagDef[] = [
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

const INITIAL_TASKS: Task[] = [
  { id: "1", title: "Client Change 1 — Hero copy revision", body: "Swap hero subhead to seasonal line. Awaiting brand asset by EOD.", note: "Brand sent v2 — needs sign-off from Priya.", createdDaysAgo: 0, x: 60, y: 110, rot: -3 },
  { id: "2", title: "Client Change 2 — Product image refresh", body: "Replace 6 PDP images with the new lifestyle set.", createdDaysAgo: 2, x: 360, y: 130, rot: 2 },
  { id: "3", title: "Client Change — Logo tint tweak", body: "Bump primary logo to #3B1D75 across header & footer.", createdDaysAgo: 5, x: 660, y: 100, rot: -1.5 },
  { id: "4", title: "Client Change 4 — Header padding", body: "Reduce top nav padding from 24 → 16 on desktop.", createdDaysAgo: 0, x: 960, y: 140, rot: 3.5 },
  { id: "5", title: "Client Change — URGENT footer link audit", body: "Remove 3 dead links. Verify legal links still resolve.", createdDaysAgo: 9, x: 1260, y: 110, rot: -2 },

  { id: "6", title: "Bug Fix — Login redirect loop", body: "Reproduces on Safari iOS 17. Likely cookie SameSite.", note: "Root cause confirmed. Patch in PR #491.", done: true, createdDaysAgo: 1, x: 60, y: 510, rot: 2.5 },
  { id: "7", title: "Bug Fix — PRIORITY date parser TZ shift", body: "All-day events drifting -1 day for AEST users.", createdDaysAgo: 11, x: 360, y: 530, rot: -2 },

  { id: "8", title: "Internal — Refactor auth middleware", body: "Split clerk-session and rbac into separate handlers.", createdDaysAgo: 3, x: 760, y: 510, rot: 3 },
  { id: "9", title: "Internal — Update onboarding doc", body: "Add screenshots for the new task creator flow.", createdDaysAgo: 0, x: 1060, y: 530, rot: -3 },

  { id: "10", title: "Review — PR #482 webhook handler", body: "Diff is +312 / -88. Needs a careful look at retries.", createdDaysAgo: 0, x: 60, y: 910, rot: -2.5 },
  { id: "11", title: "Urgent — Prepare client demo deck", body: "Need final slides for Wednesday's pitch. Add Q1 numbers.", createdDaysAgo: 0, x: 460, y: 930, rot: 1.5 },
  { id: "12", title: "Standalone — Pick lunch place", body: "Team is voting in #general. Decide by 12:00.", createdDaysAgo: 1, x: 860, y: 920, rot: -1.8 },
];

const PRIORITY_KEYWORDS = ["urgent", "priority"];

function isPriority(title: string): boolean {
  const t = title.toLowerCase();
  return PRIORITY_KEYWORDS.some((k) => t.includes(k));
}

type FilterMode = "all" | "newer" | "older" | "priority";

function matchesFilter(task: Task, mode: FilterMode): boolean {
  if (mode === "all") return true;
  if (mode === "newer") return task.createdDaysAgo <= 1;
  if (mode === "older") return task.createdDaysAgo >= 2;
  if (mode === "priority") return isPriority(task.title);
  return true;
}

const PALETTE: Omit<TagDef, "id" | "name" | "keyword">[] = [
  { swatch: "#10B981", paper: "linear-gradient(135deg,#DCFCE7 0%,#BBF7D0 100%)", ink: "#064E3B", border: "#A7F3D0", ribbon: "#059669", glow: "rgba(16,185,129,.18)" },
  { swatch: "#EC4899", paper: "linear-gradient(135deg,#FDE7F3 0%,#FBCFE8 100%)", ink: "#831843", border: "#FBCFE8", ribbon: "#DB2777", glow: "rgba(236,72,153,.18)" },
  { swatch: "#6366F1", paper: "linear-gradient(135deg,#E6E8FF 0%,#C7CCFF 100%)", ink: "#1E1B4B", border: "#C7CCFF", ribbon: "#4F46E5", glow: "rgba(99,102,241,.18)" },
  { swatch: "#14B8A6", paper: "linear-gradient(135deg,#CCFBF1 0%,#99F6E4 100%)", ink: "#134E4A", border: "#99F6E4", ribbon: "#0D9488", glow: "rgba(20,184,166,.18)" },
  { swatch: "#F97316", paper: "linear-gradient(135deg,#FFEDD5 0%,#FED7AA 100%)", ink: "#7C2D12", border: "#FED7AA", ribbon: "#EA580C", glow: "rgba(249,115,22,.18)" },
];

function matchTag(title: string, tags: TagDef[]): TagDef {
  const t = title.toLowerCase();
  for (const tag of tags) {
    if (tag.keyword && t.includes(tag.keyword)) return tag;
  }
  return NEUTRAL;
}

function formatDateLabel(daysAgo: number): { label: string; isPending: boolean; daysAgo: number; stale: boolean } {
  if (daysAgo === 0) {
    return { label: "Added today", isPending: false, daysAgo: 0, stale: false };
  }
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  return {
    label: `Pending from ${month} ${day}`,
    isPending: true,
    daysAgo,
    stale: daysAgo >= 7,
  };
}

export function Board() {
  const [tags, setTags] = useState<TagDef[]>(INITIAL_TAGS);
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [stackedGroups, setStackedGroups] = useState<Record<string, boolean>>({ "t-client": true });
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagKeyword, setNewTagKeyword] = useState("");
  const [newTagSwatch, setNewTagSwatch] = useState(PALETTE[0].swatch);
  const [openNoteFor, setOpenNoteFor] = useState<string | null>("1");
  const [searchMode, setSearchMode] = useState<"name" | "date">("name");
  const [submitted, setSubmitted] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const visibleTasks = useMemo(
    () => tasks.filter((t) => matchesFilter(t, filterMode)),
    [tasks, filterMode],
  );
  const visibleIds = useMemo(() => new Set(visibleTasks.map((t) => t.id)), [visibleTasks]);

  const grouped = useMemo(() => {
    const out: Record<string, { tag: TagDef; tasks: Task[] }> = {};
    for (const task of visibleTasks) {
      const tag = matchTag(task.title, tags);
      if (!out[tag.id]) out[tag.id] = { tag, tasks: [] };
      out[tag.id].tasks.push(task);
    }
    return out;
  }, [visibleTasks, tags]);

  const completed = tasks.filter((t) => t.done).length;
  const totalCount = tasks.length;
  const pendingCarry = tasks.filter((t) => t.createdDaysAgo > 0).length;
  const staleCount = tasks.filter((t) => t.createdDaysAgo >= 7).length;
  const priorityCount = tasks.filter((t) => isPriority(t.title)).length;
  const newerCount = tasks.filter((t) => t.createdDaysAgo <= 1).length;
  const olderCount = tasks.filter((t) => t.createdDaysAgo >= 2).length;

  const dragRef = useRef<{ id: string; offX: number; offY: number; moved: boolean } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current || !boardRef.current) return;
      dragRef.current.moved = true;
      const rect = boardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - dragRef.current.offX;
      const y = e.clientY - rect.top - dragRef.current.offY;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === dragRef.current!.id ? { ...t, x: Math.max(8, x), y: Math.max(8, y) } : t,
        ),
      );
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent, task: Task) => {
    if (!boardRef.current) return;
    const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      id: task.id,
      offX: e.clientX - target.left,
      offY: e.clientY - target.top,
      moved: false,
    };
    document.body.style.userSelect = "none";
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx < 0) return prev;
      const item = prev[idx];
      const rest = prev.filter((t) => t.id !== task.id);
      return [...rest, item];
    });
  };

  const toggleStack = (tagId: string) =>
    setStackedGroups((prev) => ({ ...prev, [tagId]: !prev[tagId] }));

  const restackGroup = (tagId: string) => {
    const group = grouped[tagId];
    if (!group) return;
    const baseX = group.tasks[0]?.x ?? 100;
    const baseY = group.tasks[0]?.y ?? 100;
    setTasks((prev) =>
      prev.map((t) => {
        const ix = group.tasks.findIndex((g) => g.id === t.id);
        if (ix < 0) return t;
        return { ...t, x: baseX + ix * 6, y: baseY + ix * 4, rot: -2 + ix * 1.4 };
      }),
    );
  };

  const fanGroup = (tagId: string) => {
    const group = grouped[tagId];
    if (!group) return;
    const baseX = group.tasks[0]?.x ?? 100;
    const baseY = group.tasks[0]?.y ?? 100;
    setTasks((prev) =>
      prev.map((t) => {
        const ix = group.tasks.findIndex((g) => g.id === t.id);
        if (ix < 0) return t;
        return { ...t, x: baseX + ix * 250, y: baseY + (ix % 2) * 18, rot: -3 + ix * 1.6 };
      }),
    );
  };

  const addTag = () => {
    if (!newTagName.trim()) return;
    const palette = PALETTE.find((p) => p.swatch === newTagSwatch) ?? PALETTE[0];
    const id = `t-${Date.now()}`;
    setTags((prev) => [...prev,
      { id, name: newTagName.trim(), keyword: (newTagKeyword || newTagName).trim().toLowerCase(), ...palette },
    ]);
    setNewTagName(""); setNewTagKeyword(""); setShowTagPanel(false);
  };

  const removeTag = (id: string) => {
    setTags((prev) => prev.filter((t) => t.id !== id));
    setStackedGroups((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const toggleDone = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const deleteTask = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id));

  const updateNote = (id: string, note: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, note } : t)));

  const addNewTask = () => {
    if (!newTaskText.trim()) return;
    const lines = newTaskText.split("\n").map((s) => s.trim()).filter(Boolean);
    setTasks((prev) => [
      ...prev,
      ...lines.map((line, i) => ({
        id: `n-${Date.now()}-${i}`,
        title: line,
        createdDaysAgo: 0,
        x: 220 + (i % 4) * 250 + Math.random() * 30,
        y: 980 + Math.floor(i / 4) * 200 + Math.random() * 20,
        rot: -3 + Math.random() * 6,
      })),
    ]);
    setNewTaskText("");
  };

  const groupOrder = [...tags.map((t) => t.id), NEUTRAL.id];

  return (
    <div
      className="min-h-screen w-full font-['Inter']"
      style={{
        background:
          "radial-gradient(1200px 600px at 20% 0%, #FBF7EE 0%, transparent 60%), radial-gradient(900px 500px at 90% 30%, #F0EAFB 0%, transparent 55%), linear-gradient(180deg, #F6F1E4 0%, #EFE8D5 100%)",
      }}
    >
      {/* Header */}
      <div className="px-10 pt-8 pb-3 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-[44px] leading-none font-semibold tracking-tight text-[#1F1B14]"
                style={{ fontFamily: "'Space Grotesk', Inter, sans-serif" }}>
              Today's Focus
            </h1>
            <span className="text-sm uppercase tracking-[0.2em] text-[#6B6452]">
              Mon · Apr 28, 2026
            </span>
            {submitted && (
              <span className="ml-1 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                <Check size={12} /> Day completed
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[13.5px] text-[#6B6452] flex-wrap">
            <span><span className="font-semibold text-[#1F1B14]">{completed}</span> of {totalCount} tasks completed</span>
            <span className="w-1 h-1 rounded-full bg-[#C7BFA8]" />
            <span className="inline-flex items-center gap-1"><Clock size={12} /> {pendingCarry} carried over</span>
            {staleCount > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-[#C7BFA8]" />
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <Flame size={12} /> {staleCount} stale (7d+)
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search with mode toggle */}
          <div className="flex items-center gap-1 rounded-full bg-white/70 backdrop-blur p-1 border border-[#E2DBC6] shadow-sm">
            <button
              onClick={() => setSearchMode("name")}
              className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${searchMode === "name" ? "bg-white text-[#1F1B14] shadow-sm" : "text-[#6B6452]"}`}
            >
              <Type size={11} /> Name
            </button>
            <button
              onClick={() => setSearchMode("date")}
              className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${searchMode === "date" ? "bg-white text-[#1F1B14] shadow-sm" : "text-[#6B6452]"}`}
            >
              <CalendarDays size={11} /> Date
            </button>
            <div className="flex items-center gap-1.5 px-2">
              <Search size={13} className="text-[#9A9279]" />
              {searchMode === "name" ? (
                <input placeholder="Search notes…"
                  className="bg-transparent text-sm placeholder:text-[#9A9279] focus:outline-none w-36" />
              ) : (
                <input type="date"
                  className="bg-transparent text-sm text-[#1F1B14] focus:outline-none w-36" />
              )}
            </div>
          </div>

          {/* View toggle */}
          <div className="flex items-center bg-white/70 backdrop-blur rounded-full p-1 border border-[#E2DBC6] shadow-sm">
            <button className="flex items-center gap-1.5 text-xs font-medium text-[#1F1B14] bg-white shadow-sm rounded-full px-3 py-1.5">
              <LayoutGrid size={13} /> Board
            </button>
            <button className="flex items-center gap-1.5 text-xs font-medium text-[#6B6452] rounded-full px-3 py-1.5">
              <Layers size={13} /> List
            </button>
          </div>

          <button onClick={() => setShowTagPanel((s) => !s)}
            className="flex items-center gap-2 bg-white text-[#1F1B14] text-sm font-medium px-3.5 py-2.5 rounded-full border border-[#E2DBC6] shadow-sm hover:bg-[#FBF7EE]">
            <Plus size={15} /> New tag
          </button>

          <button
            className="flex items-center gap-2 text-[#6B6452] hover:text-[#7A1B1B] text-sm font-medium px-3 py-2.5 rounded-full"
            title="Reset day"
          >
            <RotateCcw size={14} /> Reset day
          </button>

          <button
            onClick={() => setSubmitted((s) => !s)}
            className={`flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-full shadow-md transition-colors ${
              submitted
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-[#1F1B14] hover:bg-[#2C2618] text-[#FBF7EE]"
            }`}
          >
            {submitted ? <><Check size={15} /> Submitted</> : <><Send size={14} /> Submit day</>}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-10 pb-3 flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-[#6B6452] mr-2">
          <Filter size={12} /> Filter
        </span>
        {([
          { id: "all", label: "All", icon: <LayoutGrid size={12} />, count: totalCount, ribbon: "#1F1B14" },
          { id: "newer", label: "Newer", icon: <Sparkles size={12} />, count: newerCount, ribbon: "#0EA5E9", hint: "today / yesterday" },
          { id: "older", label: "Older", icon: <History size={12} />, count: olderCount, ribbon: "#A16207", hint: "2+ days old" },
          { id: "priority", label: "Priority", icon: <Zap size={12} />, count: priorityCount, ribbon: "#DC2626", hint: '"urgent" / "priority"' },
        ] as const).map((f) => {
          const active = filterMode === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilterMode(f.id as FilterMode)}
              title={"hint" in f ? f.hint : undefined}
              className={`flex items-center gap-1.5 text-xs font-medium pl-2 pr-1 py-1 rounded-full border shadow-sm transition-colors ${
                active
                  ? "bg-[#1F1B14] text-white border-[#1F1B14]"
                  : "bg-white/80 text-[#1F1B14] border-[#E2DBC6] hover:bg-white"
              }`}
              style={active ? { background: f.ribbon, borderColor: f.ribbon } : undefined}
            >
              {f.icon}
              {f.label}
              <span
                className={`ml-1 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                  active ? "bg-white/25 text-white" : "bg-[#FBF7EE] text-[#6B6452]"
                }`}
              >
                {f.count}
              </span>
            </button>
          );
        })}
        {filterMode !== "all" && (
          <span className="text-[11px] text-[#6B6452] italic ml-1">
            Showing {visibleTasks.length} of {totalCount} notes
          </span>
        )}
      </div>

      {/* Tag bar */}
      <div className="px-10 pb-4 flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-[#6B6452] mr-2">
          <TagIcon size={12} /> Tags
        </span>
        {tags.map((tag) => {
          const count = grouped[tag.id]?.tasks.length ?? 0;
          const stacked = !!stackedGroups[tag.id];
          return (
            <div key={tag.id}
              className="group flex items-center gap-2 pl-1 pr-1.5 py-1 rounded-full border bg-white/80 backdrop-blur shadow-sm"
              style={{ borderColor: tag.border }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: tag.swatch }}>{count}</span>
              <span className="text-sm font-medium" style={{ color: tag.ink }}>{tag.name}</span>
              <button
                onClick={() => stacked ? fanGroup(tag.id) : (toggleStack(tag.id), restackGroup(tag.id))}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full text-white"
                style={{ background: tag.ribbon }}>
                {stacked ? (<><LayoutGrid size={10} /> Unstack</>) : (<><Layers size={10} /> Stack</>)}
              </button>
              <button onClick={() => removeTag(tag.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[#9A9279] hover:text-[#1F1B14]"
                aria-label={`Remove ${tag.name}`}>
                <X size={12} />
              </button>
            </div>
          );
        })}
        {grouped[NEUTRAL.id] && (
          <div className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border bg-white/80 backdrop-blur shadow-sm"
            style={{ borderColor: NEUTRAL.border }}>
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: NEUTRAL.swatch }}>{grouped[NEUTRAL.id].tasks.length}</span>
            <span className="text-sm font-medium" style={{ color: NEUTRAL.ink }}>Untagged</span>
          </div>
        )}
      </div>

      {/* Tag creator */}
      {showTagPanel && (
        <div className="mx-10 mb-4 rounded-2xl bg-white border border-[#E2DBC6] shadow-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-[#1F1B14]">Create a tag</div>
              <div className="text-xs text-[#6B6452]">Notes whose title contains the keyword will be grouped & color-coded.</div>
            </div>
            <button onClick={() => setShowTagPanel(false)} className="text-[#9A9279] hover:text-[#1F1B14]">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-12 gap-3">
            <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Tag name (e.g. Client Change)"
              className="col-span-4 px-3 py-2 rounded-lg border border-[#E2DBC6] bg-[#FBF7EE] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F1B14]/10" />
            <input value={newTagKeyword} onChange={(e) => setNewTagKeyword(e.target.value)}
              placeholder="Match keyword (defaults to tag name)"
              className="col-span-4 px-3 py-2 rounded-lg border border-[#E2DBC6] bg-[#FBF7EE] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F1B14]/10" />
            <div className="col-span-3 flex items-center gap-2">
              {PALETTE.map((p) => (
                <button key={p.swatch} onClick={() => setNewTagSwatch(p.swatch)}
                  className="w-7 h-7 rounded-full flex items-center justify-center border-2"
                  style={{ background: p.swatch, borderColor: newTagSwatch === p.swatch ? "#1F1B14" : "transparent" }}>
                  {newTagSwatch === p.swatch && <Check size={12} className="text-white" />}
                </button>
              ))}
            </div>
            <button onClick={addTag} className="col-span-1 bg-[#1F1B14] text-white text-sm font-medium rounded-lg px-3 py-2">Add</button>
          </div>
        </div>
      )}

      {/* Board */}
      <div ref={boardRef}
        className="relative mx-10 mb-4 rounded-3xl border border-[#E2DBC6] overflow-hidden"
        style={{
          height: 1280,
          background:
            "repeating-linear-gradient(0deg, transparent 0 39px, rgba(31,27,20,0.04) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(31,27,20,0.04) 39px 40px), #FBF7EE",
        }}>

        {/* Group cluster outlines (computed only from visible notes) */}
        {groupOrder.map((tagId) => {
          const group = grouped[tagId];
          if (!group || group.tasks.length < 2) return null;
          const stacked = !!stackedGroups[tagId];
          // When stacked, all notes share the first note's anchor — bound shrinks to a single sticky.
          const xs = stacked ? [group.tasks[0].x] : group.tasks.map((t) => t.x);
          const ys = stacked ? [group.tasks[0].y] : group.tasks.map((t) => t.y);
          const minX = Math.min(...xs) - 14;
          const minY = Math.min(...ys) - 26;
          const maxX = Math.max(...xs) + (stacked ? 250 + group.tasks.length * 6 : 250) + 14;
          const maxY = Math.max(...ys) + (stacked ? 240 + group.tasks.length * 4 : 240) + 14;
          return (
            <div key={`group-${tagId}`}
              className="absolute pointer-events-none rounded-3xl"
              style={{
                left: minX, top: minY, width: maxX - minX, height: maxY - minY,
                background: group.tag.glow, border: `1.5px dashed ${group.tag.border}`,
              }}>
              <div className="absolute -top-3 left-4 px-3 py-0.5 rounded-full text-[11px] font-semibold tracking-wide text-white shadow-sm"
                style={{ background: group.tag.ribbon }}>
                {group.tag.name} · {group.tasks.length}
              </div>
            </div>
          );
        })}

        {/* Sticky notes */}
        {tasks.map((task, idx) => {
          if (!visibleIds.has(task.id)) return null;
          const tag = matchTag(task.title, tags);
          const groupTasks = grouped[tag.id]?.tasks ?? [task];
          const stacked = !!stackedGroups[tag.id] && groupTasks.length > 1;
          const stackIndex = Math.max(0, groupTasks.findIndex((t) => t.id === task.id));
          const baseTask = groupTasks[0];
          const x = stacked ? baseTask.x + stackIndex * 6 : task.x;
          const y = stacked ? baseTask.y + stackIndex * 4 : task.y;
          const rot = stacked ? -2 + stackIndex * 1.4 : task.rot;
          const isTopOfStack = stacked && stackIndex === groupTasks.length - 1;
          const dateInfo = formatDateLabel(task.createdDaysAgo);
          const showNote = openNoteFor === task.id;
          const priority = isPriority(task.title);

          return (
            <div key={task.id}
              onMouseDown={(e) => startDrag(e, task)}
              className="absolute select-none cursor-grab active:cursor-grabbing group/note"
              style={{
                left: x, top: y, width: 250,
                transform: `rotate(${rot}deg)`,
                transition: dragRef.current?.id === task.id ? "none" : "transform .25s ease, left .35s ease, top .35s ease",
                zIndex: 100 + idx + (isTopOfStack ? 50 : 0),
                filter: stacked && !isTopOfStack ? "saturate(0.92)" : "none",
              }}>
              <div className="relative rounded-[14px] p-4 pb-4"
                style={{
                  background: tag.paper,
                  borderTop: `4px solid ${tag.ribbon}`,
                  boxShadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 12px 22px -10px rgba(31,27,20,.35), 0 2px 4px rgba(31,27,20,.08)",
                  color: tag.ink,
                  outline: dateInfo.stale ? "2px solid rgba(245, 158, 11, .55)" : "none",
                }}>
                {/* Top row: tag chip + priority + grip */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.18em] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(255,255,255,0.55)", color: tag.ink }}>
                      {tag.name}
                    </span>
                    {priority && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded text-white"
                        style={{ background: "#DC2626" }}>
                        <Zap size={10} /> Priority
                      </span>
                    )}
                  </div>
                  <GripVertical size={13} className="opacity-40" />
                </div>

                {/* Title with checkbox */}
                <div className="flex items-start gap-2">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); toggleDone(task.id); }}
                    className="mt-0.5 shrink-0"
                    aria-label="Toggle done"
                  >
                    {task.done ? (
                      <CheckCircle2 size={18} style={{ color: tag.ribbon }} />
                    ) : (
                      <Circle size={18} className="opacity-50" />
                    )}
                  </button>
                  <h3 className="text-[15px] font-semibold leading-snug tracking-tight"
                      style={{ fontFamily: "'Space Grotesk', Inter, sans-serif" }}>
                    {task.done ? <span className="line-through opacity-60">{task.title}</span> : task.title}
                  </h3>
                </div>

                {task.body && (
                  <p className="text-[12.5px] leading-relaxed opacity-80 mt-1.5 ml-6">
                    {task.body}
                  </p>
                )}

                {/* Date / pending row */}
                <div className="mt-2.5 ml-6 flex items-center gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded ${
                    dateInfo.stale
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : dateInfo.isPending
                      ? "bg-white/70 text-[#6B6452] border border-white/70"
                      : "bg-white/70 text-[#6B6452]"
                  }`}>
                    <Calendar size={10} />
                    {dateInfo.label}
                  </span>
                  {dateInfo.isPending && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      dateInfo.stale ? "bg-amber-500 text-white" : "bg-[#1F1B14]/85 text-white"
                    }`}>
                      {dateInfo.daysAgo}d
                    </span>
                  )}
                  {dateInfo.stale && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800">
                      <Flame size={10} /> stale
                    </span>
                  )}
                </div>

                {/* Existing note (collapsed view) */}
                {task.note && !showNote && (
                  <div className="mt-2 ml-6 flex items-start gap-1.5 text-[12px] italic opacity-80 border-l-2 pl-2"
                    style={{ borderColor: tag.ribbon }}>
                    <MessageSquare size={11} className="mt-0.5 shrink-0" />
                    <span>{task.note}</span>
                  </div>
                )}

                {/* Inline note editor */}
                {showNote && (
                  <div onMouseDown={(e) => e.stopPropagation()} className="mt-2 ml-6">
                    <textarea
                      value={task.note ?? ""}
                      onChange={(e) => updateNote(task.id, e.target.value)}
                      placeholder="Add a quick note…"
                      className="w-full min-h-[64px] text-[12px] p-2 rounded-md bg-white/80 border border-white/90 focus:outline-none focus:ring-2 focus:ring-black/10 resize-y"
                      style={{ color: tag.ink }}
                    />
                    <div className="mt-1 flex justify-end">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenNoteFor(null); }}
                        className="text-[11px] font-medium px-2 py-0.5 rounded text-white"
                        style={{ background: tag.ribbon }}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {/* Hover actions */}
                <div className="mt-2 ml-6 flex items-center gap-1 opacity-0 group-hover/note:opacity-100 transition-opacity"
                  onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenNoteFor(showNote ? null : task.id); }}
                    className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded hover:bg-white/70"
                    title={task.note ? "Edit note" : "Add note"}
                  >
                    <MessageSquare size={11} /> {task.note ? "Edit" : "Note"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); }}
                    className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded hover:bg-white/70"
                    title="Copy text"
                  >
                    <Copy size={11} /> Copy
                  </button>
                  {!submitted && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                      className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded hover:bg-white/70 text-[#7A1B1B]"
                      title="Delete task"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  )}
                </div>

                {/* Corner curl */}
                <div className="absolute bottom-0 right-0 w-7 h-7 rounded-tl-xl rounded-br-[14px] pointer-events-none"
                  style={{ background: "linear-gradient(135deg, rgba(0,0,0,0) 50%, rgba(31,27,20,.10) 50%, rgba(31,27,20,.18) 100%)" }} />

                {isTopOfStack && (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); toggleStack(tag.id); fanGroup(tag.id); }}
                    className="absolute -top-3 -right-3 bg-white text-[#1F1B14] text-[11px] font-bold rounded-full w-9 h-9 flex flex-col items-center justify-center border-2 shadow-md leading-none"
                    style={{ borderColor: tag.ribbon }}
                  >
                    <span style={{ color: tag.ribbon }}>{groupTasks.length}</span>
                    <span className="text-[8px] opacity-60 mt-0.5">stack</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Footer tip */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-white/85 backdrop-blur border border-[#E2DBC6] shadow text-[12px] text-[#6B6452]">
          <span className="font-semibold text-[#1F1B14]">Tip</span>
          <span>·</span>
          <span>Drag any note · hover for note / copy / delete · click checkbox to mark done · click the stack badge to fan it out</span>
        </div>
      </div>

      {/* Add new tasks (matches the real app's add-more-tasks input) */}
      <div className="mx-10 mb-10 rounded-2xl bg-white/80 backdrop-blur border border-[#E2DBC6] shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-[#1F1B14]">Add more tasks</div>
          <div className="text-[11px] text-[#6B6452]">One task per line — they appear instantly on the board with today's date.</div>
        </div>
        <div className="flex items-start gap-3">
          <textarea
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            placeholder={'Client Change — New banner for promo\nBug Fix — Hover state on filter chips'}
            className="flex-1 min-h-[68px] p-3 text-sm rounded-lg border border-[#E2DBC6] bg-[#FBF7EE] focus:outline-none focus:ring-2 focus:ring-[#1F1B14]/10 resize-y"
          />
          <button
            onClick={addNewTask}
            disabled={!newTaskText.trim()}
            className="bg-[#1F1B14] hover:bg-[#2C2618] disabled:opacity-40 text-[#FBF7EE] text-sm font-medium px-4 py-2.5 rounded-lg flex items-center gap-2 self-start"
          >
            <Plus size={14} /> Add task
          </button>
        </div>
      </div>
    </div>
  );
}
