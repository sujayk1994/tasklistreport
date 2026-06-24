import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useGetTaskHistory,
  getGetTaskHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Loader2, ChevronRight, CheckCircle2, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HighlightedText } from "@/lib/highlight";

type SearchEntry = {
  id: number;
  date: string;
  submitted: boolean;
  completedCount: number;
  totalCount: number;
  matchedTasks: Array<{ id: number; text: string; completed: boolean }>;
};

export default function HistoryList() {
  const { data: historyList, isLoading } = useGetTaskHistory({
    query: {
      queryKey: getGetTaskHistoryQueryKey(),
    },
  });

  const [searchMode, setSearchMode] = useState<"name" | "date">("name");
  const [searchQuery, setSearchQuery] = useState("");
  const trimmedQuery = searchQuery.trim();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Press "/" anywhere outside an input to focus the search bar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" ||
        tag === "textarea" ||
        target?.isContentEditable === true;
      if (isTyping) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const baseEntries = historyList?.entries ?? [];

  const searchResultQuery = useQuery({
    queryKey: ["history-search", searchMode, trimmedQuery],
    enabled: !!trimmedQuery,
    staleTime: 60_000,
    queryFn: async () => {
      const url = `/api/tasks/history/search?q=${encodeURIComponent(
        trimmedQuery,
      )}&mode=${searchMode}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`);
      }
      return (await res.json()) as { entries: SearchEntry[] };
    },
  });

  const displayedEntries = useMemo<SearchEntry[]>(() => {
    if (!trimmedQuery) {
      return baseEntries.map((e) => ({ ...e, matchedTasks: [] }));
    }
    return searchResultQuery.data?.entries ?? [];
  }, [trimmedQuery, baseEntries, searchResultQuery.data]);

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isSearching = !!trimmedQuery && searchResultQuery.isFetching;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif tracking-tight mb-2">History</h1>
        <p className="text-muted-foreground">Past days and accomplishments.</p>
      </div>

      {baseEntries.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <ToggleGroup
            type="single"
            value={searchMode}
            onValueChange={(v) => {
              if (v === "name" || v === "date") {
                setSearchMode(v);
                setSearchQuery("");
              }
            }}
            className="self-start gap-0 rounded-md border border-border/60 p-0.5"
          >
            <ToggleGroupItem
              value="name"
              size="sm"
              className="px-3 text-xs data-[state=on]:bg-secondary data-[state=on]:text-foreground"
            >
              By name
            </ToggleGroupItem>
            <ToggleGroupItem
              value="date"
              size="sm"
              className="px-3 text-xs data-[state=on]:bg-secondary data-[state=on]:text-foreground"
            >
              By date
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type={searchMode === "date" ? "date" : "text"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                searchMode === "name"
                  ? "Search every past day by task name…  (press / to focus)"
                  : "Pick a date to find that day"
              }
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {baseEntries.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl bg-card/30">
          <p className="text-muted-foreground text-lg">No past days recorded yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Submit your first day from the Today view.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {isSearching && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching across all history…
            </div>
          )}

          {searchResultQuery.isError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 py-4 text-center text-sm text-destructive">
              Search failed. Please try again.
            </div>
          )}

          {trimmedQuery &&
            !isSearching &&
            !searchResultQuery.isError &&
            displayedEntries.length === 0 && (
              <div className="rounded-xl border border-dashed bg-card/30 py-10 text-center text-sm text-muted-foreground">
                No history matches your search.
              </div>
            )}

          {displayedEntries.map((entry) => {
            const dateObj = parseISO(entry.date);
            const formattedDate = format(dateObj, "EEEE, MMMM d, yyyy");
            const progress =
              entry.totalCount > 0
                ? (entry.completedCount / entry.totalCount) * 100
                : 0;
            const allCompleted =
              entry.totalCount > 0 && entry.completedCount === entry.totalCount;
            const matchedTasks = entry.matchedTasks ?? [];

            return (
              <Link key={entry.id} href={`/history/${entry.date}`}>
                <Card className="group cursor-pointer hover:border-primary/40 transition-all duration-200 overflow-hidden bg-card/60 hover:bg-card hover:shadow-md border-border/60">
                  <div className="p-5 flex items-center justify-between">
                    <div className="space-y-3 flex-1 pr-6">
                      <div className="flex items-center gap-3">
                        <h3 className="font-medium text-foreground text-lg group-hover:text-primary transition-colors">
                          {searchMode === "date" && trimmedQuery ? (
                            <HighlightedText text={formattedDate} query={trimmedQuery} />
                          ) : (
                            formattedDate
                          )}
                        </h3>
                        {allCompleted && (
                          <div className="flex items-center text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded">
                            <CheckCircle2 size={12} className="mr-1" />
                            Perfect day
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-4">
                        <Progress
                          value={progress}
                          className="h-1.5 flex-1 max-w-[200px] bg-secondary"
                        />
                        <span className="text-sm text-muted-foreground font-medium">
                          {entry.completedCount} / {entry.totalCount} completed
                        </span>
                      </div>

                      {searchMode === "name" &&
                        trimmedQuery &&
                        matchedTasks.length > 0 && (
                          <ul className="mt-2 space-y-1 border-l-2 border-primary/30 pl-3">
                            {matchedTasks.slice(0, 4).map((t) => (
                              <li
                                key={t.id}
                                className={`text-xs ${
                                  t.completed
                                    ? "text-muted-foreground line-through"
                                    : "text-foreground/80"
                                }`}
                              >
                                <HighlightedText text={t.text} query={trimmedQuery} />
                              </li>
                            ))}
                            {matchedTasks.length > 4 && (
                              <li className="text-[11px] text-muted-foreground italic">
                                +{matchedTasks.length - 4} more match
                                {matchedTasks.length - 4 === 1 ? "" : "es"}
                              </li>
                            )}
                          </ul>
                        )}
                    </div>

                    <div className="w-10 h-10 rounded-full bg-secondary/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
