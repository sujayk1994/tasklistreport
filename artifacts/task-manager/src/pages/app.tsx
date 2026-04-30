import { useState, useEffect, useCallback, useRef } from "react";
import {
  useGetTodayTasks,
  getGetTodayTasksQueryKey,
  useCreateTodayTasks,
  useAddTask,
  useToggleTask,
  useSubmitDayTasks,
  useResetTodayTasks,
  useDeleteTask,
  useUpdateTaskNote,
  useUpdateTaskText,
  useSetTaskPostedForFuture,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Check,
  RotateCcw,
  Trash2,
  MessageSquare,
  Copy,
  Search,
  X,
  LayoutGrid,
  List as ListIcon,
  Filter,
  Sparkles,
  History,
  Zap,
  CheckCircle2,
  Circle,
  Calendar,
  Send,
  Moon,
  Sun,
  PartyPopper,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
} from "lucide-react";
import { HighlightedText } from "@/lib/highlight";
import { BoardViewSafe, isPriorityTitle, daysSinceCreated } from "./board-view";

type AgeFilter = "all" | "newer" | "older" | "priority";
type CompletedFilter = "all" | "done" | "pending" | "posted";
type ViewMode = "list" | "board";

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type TaskDateLabel = {
  text: string;
  isPending: boolean;
  daysPending: number;
};

function formatTaskDateLabel(
  createdAt: string | null | undefined,
): TaskDateLabel | null {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return null;

  const today = new Date();
  const formatted = created.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  if (localDateKey(created) === localDateKey(today)) {
    return { text: `Added ${formatted}`, isPending: false, daysPending: 0 };
  }

  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfCreated = new Date(
    created.getFullYear(),
    created.getMonth(),
    created.getDate(),
  );
  const days = Math.max(
    1,
    Math.round(
      (startOfToday.getTime() - startOfCreated.getTime()) / 86400000,
    ),
  );

  return {
    text: `Pending from ${formatted}`,
    isPending: true,
    daysPending: days,
  };
}

const PAPER_BG = "var(--paper-bg)";
const FRESH_CARD_BG = "var(--fresh-card-bg)";
const PAPER_LIST_BG = "var(--paper-list-bg)";

export default function AppView() {
  const queryClient = useQueryClient();
  const [rawText, setRawText] = useState("");
  const [addText, setAddText] = useState("");
  const [comments, setComments] = useState<Record<number, string>>({});
  const savedNotesRef = useRef<Record<number, string>>({});
  const [searchMode, setSearchMode] = useState<"name" | "date">("name");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "board";
    return (window.localStorage.getItem("today-view-mode") as ViewMode) || "board";
  });
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>("all");
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [editingNoteFor, setEditingNoteFor] = useState<number | null>(null);
  const addTextRef = useRef<HTMLTextAreaElement | null>(null);
  // Persisted UI preferences (survive reloads).
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("today-dark-mode") === "1";
  });
  const [celebrations, setCelebrations] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("today-celebrations") !== "0";
  });
  // Bumping this counter tells BoardView to run "tidy" once.
  const [tidyTrigger, setTidyTrigger] = useState(0);

  useEffect(() => {
    try { window.localStorage.setItem("today-view-mode", viewMode); } catch {}
  }, [viewMode]);

  useEffect(() => {
    try { window.localStorage.setItem("today-dark-mode", darkMode ? "1" : "0"); } catch {}
    // Toggle the dark class on the document root so any tailwind dark: variants
    // (and child portals like dialogs) get the right palette.
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", darkMode);
    }
  }, [darkMode]);

  useEffect(() => {
    try { window.localStorage.setItem("today-celebrations", celebrations ? "1" : "0"); } catch {}
  }, [celebrations]);

  // Board fullscreen — when on, the board covers the whole browser window
  // (sidebar + header are hidden) and we also request native browser
  // fullscreen so even browser chrome goes away. ESC exits.
  const [boardFullscreen, setBoardFullscreen] = useState<boolean>(false);

  // Zen mode — hides ALL chrome (top toolbar + the in-board tag/snap/tidy
  // toolbar) so only the sticky notes are visible. A small floating exit
  // pill stays in the corner so the user can come back.
  const [boardZen, setBoardZen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("today-board-zen") === "1";
  });

  useEffect(() => {
    try { window.localStorage.setItem("today-board-zen", boardZen ? "1" : "0"); } catch {}
  }, [boardZen]);

  useEffect(() => {
    if (viewMode !== "board" && boardFullscreen) {
      setBoardFullscreen(false);
    }
    if (viewMode !== "board" && boardZen) {
      setBoardZen(false);
    }
  }, [viewMode, boardFullscreen, boardZen]);

  // When the user enters fullscreen, ask the board to re-tidy after the
  // resize transition has settled so notes repack nicely into the larger area.
  useEffect(() => {
    if (!boardFullscreen) return;
    const t = window.setTimeout(() => {
      setTidyTrigger((n) => n + 1);
    }, 220);
    return () => window.clearTimeout(t);
  }, [boardFullscreen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (boardFullscreen) {
      const el = document.documentElement;
      const req = (el as any).requestFullscreen ?? (el as any).webkitRequestFullscreen;
      if (req) {
        try { req.call(el); } catch {}
      }
    } else if (document.fullscreenElement) {
      const exit = (document as any).exitFullscreen ?? (document as any).webkitExitFullscreen;
      if (exit) {
        try { exit.call(document); } catch {}
      }
    }
  }, [boardFullscreen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setBoardFullscreen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && boardFullscreen) {
        setBoardFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [boardFullscreen]);

  const { data: taskList, isLoading } = useGetTodayTasks({
    query: { queryKey: getGetTodayTasksQueryKey() },
  });

  useEffect(() => {
    if (!taskList?.tasks) return;
    const loaded: Record<number, string> = {};
    for (const t of taskList.tasks) {
      loaded[t.id] = t.note;
    }
    setComments((prev) => {
      const merged = { ...loaded };
      for (const id of Object.keys(prev)) {
        const numId = Number(id);
        if (numId in loaded) merged[numId] = prev[numId];
      }
      return merged;
    });
    savedNotesRef.current = loaded;
  }, [taskList]);

  // Global keyboard shortcuts:
  //   /   — focus the search bar
  //   N   — open the Add task drawer + focus its textarea
  //   T   — tidy the board (board view only)
  //   Esc — clear search / close the Add panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true;

      // Esc works even while typing — it's the universal "back out" key.
      if (e.key === "Escape") {
        if (searchQuery) setSearchQuery("");
        if (showAddPanel) {
          setShowAddPanel(false);
          setAddText("");
        }
        return;
      }

      if (isTyping) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (taskList?.submitted) return;
        e.preventDefault();
        setShowAddPanel(true);
        // Focus after the panel mounts.
        setTimeout(() => addTextRef.current?.focus(), 30);
        return;
      }
      if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (viewMode !== "board") return;
        e.preventDefault();
        setTidyTrigger((n) => n + 1);
        return;
      }
      // Z — toggle Zen mode (which hides every toolbar). Board view only.
      if ((e.key === "z" || e.key === "Z") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (viewMode !== "board") return;
        e.preventDefault();
        setBoardZen((v) => !v);
        return;
      }
      // Ctrl/Cmd+B — toggle the global sidebar (Layout listens to the
      // custom event so we don't have to thread a prop through here).
      if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("task-manager:toggle-sidebar"));
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchQuery, showAddPanel, viewMode, taskList?.submitted]);

  const createTasks = useCreateTodayTasks();
  const addTask = useAddTask();
  const toggleTask = useToggleTask();
  const submitDay = useSubmitDayTasks();
  const resetDay = useResetTodayTasks();
  const deleteTask = useDeleteTask();
  const updateNote = useUpdateTaskNote();
  const updateText = useUpdateTaskText();
  const setPostedForFuture = useSetTaskPostedForFuture();

  const handleCreate = () => {
    if (!rawText.trim()) return;
    createTasks.mutate(
      { data: { rawText } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTodayTasksQueryKey(), data);
          setRawText("");
          toast.success("Checklist created");
        },
        onError: () => toast.error("Failed to create checklist"),
      },
    );
  };

  const handleAddTask = () => {
    if (!addText.trim()) return;
    addTask.mutate(
      { data: { rawText: addText } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTodayTasksQueryKey(), data);
          setAddText("");
          toast.success("Task added");
          setShowAddPanel(false);
        },
        onError: () => toast.error("Failed to add task"),
      },
    );
  };

  // Restore a deleted note from the recycle bin: re-create it and, if it had
  // a saved comment, re-attach that comment once the new task id comes back.
  const handleRestoreFromBin = (text: string, note?: string) => {
    if (taskList?.submitted) return;
    addTask.mutate(
      { data: { rawText: text } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTodayTasksQueryKey(), data);
          toast.success("Restored from bin");
          if (note && note.trim() && data?.tasks?.length) {
            // The newly-created task has the highest id (server appends).
            const newest = [...data.tasks].sort((a, b) => b.id - a.id)[0];
            if (newest) {
              updateNote.mutate(
                { data: { taskId: newest.id, note } },
                {
                  onSuccess: (updated) => {
                    queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
                      if (!old) return old;
                      return {
                        ...old,
                        tasks: old.tasks.map((t: any) =>
                          t.id === newest.id ? { ...t, note: updated.note } : t,
                        ),
                      };
                    });
                    setComments((prev) => ({ ...prev, [newest.id]: updated.note }));
                    savedNotesRef.current[newest.id] = updated.note;
                  },
                },
              );
            }
          }
        },
        onError: () => toast.error("Failed to restore"),
      },
    );
  };

  const handleToggle = (taskId: number) => {
    if (taskList?.submitted) return;
    queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
      if (!old) return old;
      return {
        ...old,
        tasks: old.tasks.map((t: any) =>
          t.id === taskId ? { ...t, completed: !t.completed } : t,
        ),
      };
    });
    toggleTask.mutate(
      { data: { taskId } },
      {
        onError: () => {
          queryClient.invalidateQueries({ queryKey: getGetTodayTasksQueryKey() });
          toast.error("Failed to update task");
        },
      },
    );
  };

  const handleDeleteTask = (taskId: number) => {
    if (taskList?.submitted) return;
    queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
      if (!old) return old;
      return { ...old, tasks: old.tasks.filter((t: any) => t.id !== taskId) };
    });
    deleteTask.mutate(
      { data: { taskId } },
      {
        onSuccess: () => toast.success("Task removed"),
        onError: () => {
          queryClient.invalidateQueries({ queryKey: getGetTodayTasksQueryKey() });
          toast.error("Failed to remove task");
        },
      },
    );
  };

  const handleNoteBlur = useCallback(
    (taskId: number, note: string) => {
      if (note === savedNotesRef.current[taskId]) return;
      savedNotesRef.current[taskId] = note;
      updateNote.mutate(
        { data: { taskId, note } },
        {
          onSuccess: (updated) => {
            queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
              if (!old) return old;
              return {
                ...old,
                tasks: old.tasks.map((t: any) =>
                  t.id === taskId ? { ...t, note: updated.note } : t,
                ),
              };
            });
          },
          onError: () => toast.error("Failed to save note"),
        },
      );
    },
    [updateNote, queryClient],
  );

  const handleCopyTask = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  // Inline-edit a task's title text.
  const handleTextChange = useCallback(
    (taskId: number, text: string) => {
      if (taskList?.submitted) return;
      // Optimistic update so the new title appears instantly.
      queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tasks: old.tasks.map((t: any) =>
            t.id === taskId ? { ...t, text } : t,
          ),
        };
      });
      updateText.mutate(
        { data: { taskId, text } },
        {
          onSuccess: (updated: any) => {
            queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
              if (!old) return old;
              return {
                ...old,
                tasks: old.tasks.map((t: any) =>
                  t.id === taskId ? { ...t, text: updated.text } : t,
                ),
              };
            });
          },
          onError: () => {
            queryClient.invalidateQueries({ queryKey: getGetTodayTasksQueryKey() });
            toast.error("Failed to update task text");
          },
        },
      );
    },
    [updateText, queryClient, taskList?.submitted],
  );

  // Toggle a task's "posted for future" flag.
  const handleSetPostedForFuture = useCallback(
    (taskId: number, value: boolean) => {
      if (taskList?.submitted) return;
      queryClient.setQueryData(getGetTodayTasksQueryKey(), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          tasks: old.tasks.map((t: any) =>
            t.id === taskId ? { ...t, postedForFuture: value } : t,
          ),
        };
      });
      setPostedForFuture.mutate(
        { data: { taskId, postedForFuture: value } },
        {
          onSuccess: () => {
            if (value) toast.success("Filed for tonight's report");
          },
          onError: () => {
            queryClient.invalidateQueries({ queryKey: getGetTodayTasksQueryKey() });
            toast.error("Failed to update");
          },
        },
      );
    },
    [setPostedForFuture, queryClient, taskList?.submitted],
  );

  const handleSubmitDay = () => {
    submitDay.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetTodayTasksQueryKey() });
        if (data?.success === false) {
          toast.error(data.message || "Failed to send email");
        } else {
          toast.success(data?.message || "Day submitted successfully");
        }
      },
      onError: (err: any) => {
        const apiMessage =
          err?.response?.data?.message ||
          err?.data?.message ||
          err?.message;
        toast.error(apiMessage || "Failed to submit day");
      },
    });
  };

  const handleResetDay = () => {
    resetDay.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetTodayTasksQueryKey(), {
          id: 0,
          date: "",
          submitted: false,
          submittedAt: null,
          tasks: [],
        });
        setRawText("");
        setAddText("");
        toast.success("Day reset — ready to start fresh");
      },
      onError: () => toast.error("Failed to reset day"),
    });
  };

  if (isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ background: PAPER_BG }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-[#6B6452]" />
      </div>
    );
  }

  const hasTasks = !!taskList && taskList.tasks.length > 0;
  const completedCount = taskList?.tasks.filter((t) => t.completed).length ?? 0;
  const totalCount = taskList?.tasks.length ?? 0;
  const allCompleted = totalCount > 0 && completedCount === totalCount;
  const isSubmitted = !!taskList?.submitted;
  const today = new Date();
  const dateLine = today.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Empty state — fresh "compose" canvas.
  if (!hasTasks) {
    return (
      <div
        className="flex-1 flex flex-col min-h-0"
        style={{ background: PAPER_BG }}
      >
        <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6F58] flex items-center gap-1.5">
              <Calendar size={12} /> {dateLine}
            </p>
            <h1
              className="text-3xl md:text-4xl font-serif tracking-tight text-[#1F1B14] mt-1"
              style={{ fontFamily: "'Fraunces', 'DM Serif Display', serif" }}
            >
              Good morning.
            </h1>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-6 lg:px-10 pb-10">
          <div className="max-w-3xl mx-auto mt-6">
            <div
              className="rounded-3xl border border-[#E2DBC6] shadow-[0_30px_70px_-30px_rgba(31,27,20,0.25)] overflow-hidden"
              style={{ background: FRESH_CARD_BG }}
            >
              <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#EFE7CF]">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6F58]">
                    A fresh page
                  </p>
                  <h2 className="text-xl font-semibold text-[#1F1B14] mt-1">
                    What needs to get done today?
                  </h2>
                </div>
                <Sparkles className="w-5 h-5 text-[#C49B3A]" />
              </div>
              <Textarea
                placeholder="Paste your tasks, one per line…"
                className="min-h-[260px] text-[15px] leading-relaxed resize-none border-0 bg-transparent rounded-none px-6 py-5 focus-visible:ring-0 placeholder:text-[#A89E83]"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
                }}
              />
              <div className="px-6 py-3 flex items-center justify-between border-t border-[#EFE7CF] bg-[#FBF5E5]/60">
                <span className="text-[11px] text-[#7A6F58]">
                  Tip: ⌘/Ctrl + Enter to create
                </span>
                <Button
                  onClick={handleCreate}
                  disabled={!rawText.trim() || createTasks.isPending}
                  className="gap-2 bg-[#1F1B14] hover:bg-[#2D2618] text-white"
                >
                  {createTasks.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Create checklist
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const trimmedQuery = searchQuery.trim();
  const ageMatches = (t: typeof taskList.tasks[number]) => {
    if (ageFilter === "all") return true;
    const days = daysSinceCreated((t as { createdAt?: string }).createdAt);
    if (ageFilter === "newer") return days <= 1;
    if (ageFilter === "older") return days >= 2;
    if (ageFilter === "priority") return isPriorityTitle(t.text);
    return true;
  };
  const completedMatches = (t: typeof taskList.tasks[number]) => {
    const isPosted = !!(t as { postedForFuture?: boolean }).postedForFuture;
    // The "Posted" filter is exclusive — show only posted tasks.
    if (completedFilter === "posted") return isPosted;
    // Every other filter hides posted tasks (they live in their own folder).
    if (isPosted) return false;
    if (completedFilter === "all") return true;
    if (completedFilter === "done") return t.completed;
    return !t.completed;
  };
  const searchMatches = (t: typeof taskList.tasks[number]) => {
    if (!trimmedQuery) return true;
    if (searchMode === "name") {
      const haystack = `${t.text} ${t.note ?? ""}`.toLowerCase();
      return haystack.includes(trimmedQuery.toLowerCase());
    }
    const created = (t as { createdAt?: string }).createdAt;
    if (!created) return false;
    const d = new Date(created);
    if (isNaN(d.getTime())) return false;
    return localDateKey(d) === trimmedQuery;
  };
  const sortedTasks = [...taskList.tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.position - b.position;
  });
  const filteredTasks = sortedTasks.filter(
    (t) => ageMatches(t) && completedMatches(t) && searchMatches(t),
  );

  const priorityCount = taskList.tasks.filter((t) => isPriorityTitle(t.text)).length;
  const newerCount = taskList.tasks.filter(
    (t) => daysSinceCreated((t as { createdAt?: string }).createdAt) <= 1,
  ).length;
  const olderCount = taskList.tasks.filter(
    (t) => daysSinceCreated((t as { createdAt?: string }).createdAt) >= 2,
  ).length;
  const pendingCount = taskList.tasks.filter(
    (t) => !t.completed && !(t as { postedForFuture?: boolean }).postedForFuture,
  ).length;
  const postedCountTop = taskList.tasks.filter(
    (t) => !!(t as { postedForFuture?: boolean }).postedForFuture,
  ).length;
  const progressPct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  return (
    <div
      className={
        boardFullscreen
          ? "fixed inset-0 z-50 flex flex-col"
          : "flex-1 flex flex-col min-h-0"
      }
      style={{ background: PAPER_BG }}
    >
      {/* Top chrome — single coherent toolbar (hidden in Zen mode) */}
      {!boardZen && (
      <div className="border-b border-[#E2DBC6] bg-[#FBF5E5]/70 backdrop-blur-md">
        <div className="px-5 lg:px-8 pt-4 pb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6F58] flex items-center gap-1.5">
              <Calendar size={12} /> {dateLine}
            </p>
            <h1
              className="text-2xl md:text-3xl font-serif tracking-tight text-[#1F1B14] mt-1 truncate"
              style={{ fontFamily: "'Fraunces', 'DM Serif Display', serif" }}
            >
              Today's Workspace
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Progress chip */}
            <div className="hidden md:flex items-center gap-2 pl-3 pr-1 py-1 rounded-full border border-[#E2DBC6] bg-white/80 shadow-sm">
              <span className="text-xs font-semibold text-[#1F1B14] tabular-nums">
                {completedCount}/{totalCount}
              </span>
              <div className="relative w-24 h-1.5 rounded-full bg-[#EFE7CF] overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                  style={{
                    width: `${progressPct}%`,
                    background: allCompleted
                      ? "linear-gradient(90deg,#16A34A,#22C55E)"
                      : "linear-gradient(90deg,#7C3AED,#EC4899)",
                  }}
                />
              </div>
              <span className="text-[11px] font-bold text-[#7A6F58] tabular-nums px-1">
                {progressPct}%
              </span>
            </div>

            {isSubmitted && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                <Check size={12} />
                Submitted
              </div>
            )}

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center justify-center w-8 h-8 rounded-full border border-[#E2DBC6] bg-white/80 text-[#1F1B14] hover:bg-white shadow-sm"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={() => setCelebrations((c) => !c)}
              title={
                celebrations
                  ? "Celebrations on — click to silence sound and confetti"
                  : "Celebrations off — click to enable sound and confetti"
              }
              aria-label={celebrations ? "Disable celebrations" : "Enable celebrations"}
              className={`flex items-center justify-center w-8 h-8 rounded-full border shadow-sm transition-colors ${
                celebrations
                  ? "bg-[#1F1B14] text-white border-[#1F1B14]"
                  : "bg-white/80 text-[#1F1B14] border-[#E2DBC6] hover:bg-white"
              }`}
            >
              <PartyPopper className="w-3.5 h-3.5" />
            </button>

            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => {
                if (v === "list" || v === "board") setViewMode(v as ViewMode);
              }}
              className="self-start gap-0 rounded-full border border-[#E2DBC6] bg-white/80 p-0.5 shadow-sm"
            >
              <ToggleGroupItem
                value="board"
                size="sm"
                className="px-3 text-xs gap-1.5 rounded-full data-[state=on]:bg-[#1F1B14] data-[state=on]:text-white"
                title="Sticky board view"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Board
              </ToggleGroupItem>
              <ToggleGroupItem
                value="list"
                size="sm"
                className="px-3 text-xs gap-1.5 rounded-full data-[state=on]:bg-[#1F1B14] data-[state=on]:text-white"
                title="List view"
              >
                <ListIcon className="w-3.5 h-3.5" /> List
              </ToggleGroupItem>
            </ToggleGroup>

            {viewMode === "board" && (
              <button
                type="button"
                onClick={() => setBoardZen((v) => !v)}
                title={boardZen ? "Show toolbars" : "Zen mode — hide all toolbars"}
                aria-label={boardZen ? "Show toolbars" : "Enter zen mode"}
                className="flex items-center justify-center w-8 h-8 rounded-full border border-[#E2DBC6] bg-white/80 text-[#1F1B14] hover:bg-white shadow-sm"
              >
                {boardZen ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {viewMode === "board" && (
              <button
                type="button"
                onClick={() => setBoardFullscreen((v) => !v)}
                title={boardFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen board"}
                aria-label={boardFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                className="flex items-center justify-center w-8 h-8 rounded-full border border-[#E2DBC6] bg-white/80 text-[#1F1B14] hover:bg-white shadow-sm"
              >
                {boardFullscreen ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {!isSubmitted && (
              <Button
                size="sm"
                onClick={() => setShowAddPanel((v) => !v)}
                className="gap-1.5 rounded-full bg-[#1F1B14] hover:bg-[#2D2618] text-white px-3"
              >
                <Plus className="w-3.5 h-3.5" /> Add task
              </Button>
            )}

            {!isSubmitted && (
              <Button
                size="sm"
                onClick={handleSubmitDay}
                disabled={submitDay.isPending}
                variant="secondary"
                className={`gap-1.5 rounded-full px-3 ${
                  allCompleted
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-white/80 border border-[#E2DBC6] text-[#1F1B14] hover:bg-white"
                }`}
              >
                {submitDay.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Submit day
              </Button>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 rounded-full text-[#7A6F58] hover:text-[#7A1B1B] hover:bg-white/60"
                  disabled={resetDay.isPending}
                  title="Reset day"
                >
                  {resetDay.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset today's tasks?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all of today's tasks and let you start over. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetDay}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, reset day
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Search + filter strip */}
        <div className="px-5 lg:px-8 pb-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center rounded-full border border-[#E2DBC6] bg-white/80 shadow-sm pl-3 pr-1 h-9 min-w-[260px] flex-1 max-w-xl">
            <Search className="w-4 h-4 text-[#9A9279] mr-2 shrink-0" />
            <Input
              ref={searchInputRef}
              type={searchMode === "date" ? "date" : "text"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                searchMode === "name"
                  ? "Search today's tasks…  (press / to focus)"
                  : "Pick a date"
              }
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 h-7 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="rounded-full p-1 text-[#9A9279] hover:text-[#1F1B14]"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <ToggleGroup
              type="single"
              value={searchMode}
              onValueChange={(v) => {
                if (v === "name" || v === "date") {
                  setSearchMode(v);
                  setSearchQuery("");
                }
              }}
              className="ml-1 gap-0 rounded-full bg-[#F4ECD8] p-0.5"
            >
              <ToggleGroupItem
                value="name"
                size="sm"
                className="h-6 px-2 text-[10px] uppercase tracking-wide rounded-full data-[state=on]:bg-[#1F1B14] data-[state=on]:text-white"
              >
                Name
              </ToggleGroupItem>
              <ToggleGroupItem
                value="date"
                size="sm"
                className="h-6 px-2 text-[10px] uppercase tracking-wide rounded-full data-[state=on]:bg-[#1F1B14] data-[state=on]:text-white"
              >
                Date
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.22em] text-[#7A6F58] mr-1">
              <Filter size={11} /> Filter
            </span>
            {([
              { id: "all", label: "All", icon: <LayoutGrid size={11} />, count: totalCount },
              { id: "newer", label: "Newer", icon: <Sparkles size={11} />, count: newerCount, hint: "today / yesterday" },
              { id: "older", label: "Older", icon: <History size={11} />, count: olderCount, hint: "2+ days old" },
              { id: "priority", label: "Priority", icon: <Zap size={11} />, count: priorityCount, hint: '"urgent" / "priority"' },
            ] as const).map((f) => {
              const active = ageFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAgeFilter(f.id as AgeFilter)}
                  title={"hint" in f ? f.hint : undefined}
                  className={`flex items-center gap-1 text-[11px] font-medium pl-2 pr-1 py-0.5 rounded-full border transition-colors ${
                    active
                      ? "bg-[#1F1B14] text-white border-[#1F1B14]"
                      : "bg-white/70 text-[#1F1B14] border-[#E2DBC6] hover:bg-white"
                  }`}
                >
                  {f.icon}
                  {f.label}
                  <span
                    className={`ml-0.5 text-[9px] font-bold rounded-full px-1.5 py-0.5 ${
                      active ? "bg-white/20 text-white" : "bg-[#F4ECD8] text-[#7A6F58]"
                    }`}
                  >
                    {f.count}
                  </span>
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-[#E2DBC6]" />
            {([
              { id: "all", label: "All", icon: <LayoutGrid size={11} />, count: totalCount },
              { id: "pending", label: "Pending", icon: <Circle size={11} />, count: pendingCount },
              { id: "done", label: "Done", icon: <CheckCircle2 size={11} />, count: completedCount },
              { id: "posted", label: "Posted", icon: <Send size={11} />, count: postedCountTop },
            ] as const).map((f) => {
              const active = completedFilter === f.id;
              return (
                <button
                  key={`c-${f.id}`}
                  type="button"
                  onClick={() => setCompletedFilter(f.id as CompletedFilter)}
                  className={`flex items-center gap-1 text-[11px] font-medium pl-2 pr-1 py-0.5 rounded-full border transition-colors ${
                    active
                      ? "bg-[#1F1B14] text-white border-[#1F1B14]"
                      : "bg-white/70 text-[#1F1B14] border-[#E2DBC6] hover:bg-white"
                  }`}
                >
                  {f.icon}
                  {f.label}
                  <span
                    className={`ml-0.5 text-[9px] font-bold rounded-full px-1.5 py-0.5 ${
                      active ? "bg-white/20 text-white" : "bg-[#F4ECD8] text-[#7A6F58]"
                    }`}
                  >
                    {f.count}
                  </span>
                </button>
              );
            })}
            {(ageFilter !== "all" || completedFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setAgeFilter("all");
                  setCompletedFilter("all");
                }}
                className="text-[10.5px] text-[#7A6F58] hover:text-[#1F1B14] underline underline-offset-2 ml-1"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Add task drawer (works in both views) */}
        {showAddPanel && !isSubmitted && (
          <div className="px-5 lg:px-8 pb-3 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="rounded-2xl border border-[#E2DBC6] bg-white/85 shadow-sm p-3 flex flex-col sm:flex-row gap-2">
              <Textarea
                ref={addTextRef}
                placeholder="One task per line…"
                className="min-h-[64px] text-sm resize-none border-[#E2DBC6] bg-[#FBF7EE] focus-visible:ring-black/10"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddTask();
                }}
              />
              <div className="flex sm:flex-col gap-2 sm:w-32">
                <Button
                  onClick={handleAddTask}
                  disabled={!addText.trim() || addTask.isPending}
                  className="flex-1 gap-2 bg-[#1F1B14] hover:bg-[#2D2618] text-white"
                >
                  {addTask.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowAddPanel(false);
                    setAddText("");
                  }}
                  className="text-[#7A6F58]"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Floating exit-zen pill (only visible while Zen mode is on).
          Anchored to the top-LEFT so it never collides with the
          board's right-anchored Completed / Posted-for-Future folders. */}
      {boardZen && viewMode === "board" && (
        <button
          type="button"
          onClick={() => setBoardZen(false)}
          title="Exit zen mode — show toolbars (Z)"
          aria-label="Exit zen mode"
          className="fixed top-3 left-3 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E2DBC6] bg-white/90 backdrop-blur shadow-md text-[#1F1B14] hover:bg-white text-xs font-medium"
        >
          <Eye className="w-3.5 h-3.5" />
          Show toolbars
        </button>
      )}

      {/* Body — fills remaining viewport */}
      <div className="flex-1 min-h-0 flex flex-col p-3 lg:p-4">
        {viewMode === "board" ? (
          <BoardViewSafe
            tasks={taskList.tasks as any}
            isSubmitted={isSubmitted}
            searchQuery={searchQuery}
            searchMode={searchMode}
            ageFilter={ageFilter}
            completedFilter={completedFilter}
            onToggle={handleToggle}
            onDelete={handleDeleteTask}
            onCopy={handleCopyTask}
            onNoteChange={(id, val) => setComments((prev) => ({ ...prev, [id]: val }))}
            onNoteBlur={handleNoteBlur}
            comments={comments}
            darkMode={darkMode}
            celebrations={celebrations}
            tidyTrigger={tidyTrigger}
            onRestore={handleRestoreFromBin}
            hideToolbar={boardZen}
            onTextChange={handleTextChange}
            onSetPostedForFuture={handleSetPostedForFuture}
          />
        ) : (
          <ListView
            tasks={filteredTasks}
            trimmedQuery={trimmedQuery}
            searchMode={searchMode}
            isSubmitted={isSubmitted}
            comments={comments}
            editingNoteFor={editingNoteFor}
            setEditingNoteFor={setEditingNoteFor}
            onToggle={handleToggle}
            onDelete={handleDeleteTask}
            onCopy={handleCopyTask}
            onNoteChange={(id, val) =>
              setComments((prev) => ({ ...prev, [id]: val }))
            }
            onNoteBlur={handleNoteBlur}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* List view — same warm aesthetic as the board, vertical card list           */
/* -------------------------------------------------------------------------- */

type ListTask = {
  id: number;
  text: string;
  completed: boolean;
  note: string;
  position: number;
  createdAt?: string;
};

function ListView({
  tasks,
  trimmedQuery,
  searchMode,
  isSubmitted,
  comments,
  editingNoteFor,
  setEditingNoteFor,
  onToggle,
  onDelete,
  onCopy,
  onNoteChange,
  onNoteBlur,
}: {
  tasks: ListTask[];
  trimmedQuery: string;
  searchMode: "name" | "date";
  isSubmitted: boolean;
  comments: Record<number, string>;
  editingNoteFor: number | null;
  setEditingNoteFor: (id: number | null) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onCopy: (text: string) => void;
  onNoteChange: (id: number, val: string) => void;
  onNoteBlur: (id: number, val: string) => void;
}) {
  return (
    <div
      className="flex-1 min-h-0 overflow-auto rounded-3xl border border-[#E2DBC6] shadow-inner"
      style={{ background: PAPER_LIST_BG }}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-2.5">
        {tasks.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D6CDB1] bg-white/40 px-4 py-10 text-center text-sm text-[#7A6F58]">
            {trimmedQuery
              ? "No tasks match your search."
              : "No tasks match the current filter."}
          </div>
        )}
        {tasks.map((task) => {
          const label = formatTaskDateLabel(task.createdAt);
          const isStale = (label?.daysPending ?? 0) >= 7;
          const noteValue = comments[task.id] ?? task.note ?? "";
          const editingNote = editingNoteFor === task.id;
          const priority = isPriorityTitle(task.text);

          return (
            <div
              key={task.id}
              className={`group relative rounded-2xl border transition-all duration-200 ${
                task.completed
                  ? "bg-white/40 border-[#E5DDC4]"
                  : isStale
                  ? "bg-amber-50/70 border-amber-200 shadow-sm"
                  : "bg-white/85 border-[#E2DBC6] shadow-[0_1px_0_rgba(255,255,255,.7)_inset,0_8px_18px_-12px_rgba(31,27,20,.25)] hover:shadow-[0_1px_0_rgba(255,255,255,.7)_inset,0_14px_28px_-14px_rgba(31,27,20,.28)]"
              } ${isSubmitted ? "opacity-90" : ""}`}
            >
              <div className="flex items-start gap-3 p-4">
                <button
                  type="button"
                  onClick={() => onToggle(task.id)}
                  disabled={isSubmitted}
                  className="mt-0.5 shrink-0 disabled:cursor-not-allowed"
                  aria-label="Toggle done"
                >
                  {task.completed ? (
                    <CheckCircle2
                      size={20}
                      className="text-emerald-600"
                    />
                  ) : (
                    <Circle size={20} className="text-[#9A9279]" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        {priority && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.16em] font-bold px-1.5 py-0.5 rounded text-white bg-rose-600">
                            <Zap size={10} /> Priority
                          </span>
                        )}
                        {label && (
                          <span
                            className={`inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded ${
                              isStale && !task.completed
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : "bg-[#F4ECD8] text-[#7A6F58]"
                            }`}
                          >
                            {label.isPending ? (
                              <Calendar size={10} />
                            ) : (
                              <Sparkles size={10} />
                            )}
                            {label.text}
                          </span>
                        )}
                        {label?.isPending && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              isStale && !task.completed
                                ? "bg-amber-500 text-white"
                                : "bg-[#1F1B14]/85 text-white"
                            }`}
                          >
                            {label.daysPending}d
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-[15px] leading-relaxed ${
                          task.completed
                            ? "text-[#9A9279] line-through"
                            : "text-[#1F1B14] font-medium"
                        }`}
                        style={{ fontFamily: "'Space Grotesk', Inter, sans-serif" }}
                      >
                        {trimmedQuery && searchMode === "name" ? (
                          <HighlightedText text={task.text} query={trimmedQuery} />
                        ) : (
                          task.text
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingNoteFor(editingNote ? null : task.id)
                        }
                        className={`flex items-center justify-center w-7 h-7 rounded-md hover:bg-[#F4ECD8] ${
                          noteValue ? "text-[#7C3AED]" : "text-[#9A9279]"
                        }`}
                        title={noteValue ? "Edit note" : "Add note"}
                      >
                        <MessageSquare size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onCopy(task.text)}
                        className="flex items-center justify-center w-7 h-7 rounded-md text-[#9A9279] hover:bg-[#F4ECD8]"
                        title="Copy task text"
                      >
                        <Copy size={14} />
                      </button>
                      {!isSubmitted && (
                        <button
                          type="button"
                          onClick={() => onDelete(task.id)}
                          className="flex items-center justify-center w-7 h-7 rounded-md text-[#9A9279] hover:bg-rose-50 hover:text-rose-700"
                          title="Remove task"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {noteValue && !editingNote && (
                    <div className="mt-2 flex items-start gap-1.5 text-[12.5px] italic text-[#5C543F] border-l-2 border-[#7C3AED]/40 pl-2">
                      <MessageSquare size={11} className="mt-0.5 shrink-0" />
                      <span className="break-words">{noteValue}</span>
                    </div>
                  )}

                  {editingNote && (
                    <div className="mt-2">
                      <Textarea
                        placeholder="Add a quick note for this task…"
                        className="min-h-[70px] text-[13px] resize-none bg-[#FBF7EE] border-[#E2DBC6] focus-visible:ring-black/10"
                        value={noteValue}
                        onChange={(e) => onNoteChange(task.id, e.target.value)}
                        onBlur={(e) => onNoteBlur(task.id, e.target.value)}
                        readOnly={isSubmitted}
                      />
                      <div className="mt-1 flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => setEditingNoteFor(null)}
                          className="h-7 text-[11px] bg-[#1F1B14] hover:bg-[#2D2618] text-white"
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
