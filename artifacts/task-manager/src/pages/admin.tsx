import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsAdmin } from "@/hooks/use-admin";
import { Redirect } from "wouter";
import {
  Shield,
  ChevronRight,
  Users,
  CheckCircle2,
  Circle,
  FileText,
  Printer,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type UserEntry = {
  userId: string;
  displayName: string;
  dates: { id: number; date: string; submitted: boolean; completedCount: number; totalCount: number }[];
};

type TaskItem = { id: number; text: string; completed: boolean; position: number };
type TaskDetail = {
  id: number;
  date: string;
  submitted: boolean;
  submittedAt: string | null;
  userId: string;
  tasks: TaskItem[];
};

type ReportTask = {
  id: number;
  text: string;
  completed: boolean;
  note: string | null;
  postedForFuture: boolean;
};
type ReportDay = {
  listId: number;
  userId: string;
  userName: string;
  date: string;
  submitted: boolean;
  tasks: ReportTask[];
};
type ReportPayload = { from: string; to: string; days: ReportDay[] };

async function fetchAdminUsers(): Promise<{ users: UserEntry[] }> {
  const res = await fetch("/api/admin/users", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

async function fetchUserDateTasks(userId: string, date: string): Promise<TaskDetail> {
  const res = await fetch(
    `/api/admin/users/${encodeURIComponent(userId)}/tasks/${date}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

async function fetchAdminReport(from: string, to: string): Promise<ReportPayload> {
  const url = `/api/admin/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to load report");
  }
  return res.json();
}

function TaskDetailPanel({
  userId,
  date,
  onBack,
}: {
  userId: string;
  date: string;
  onBack: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-tasks", userId, date],
    queryFn: () => fetchUserDateTasks(userId, date),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>;
  if (!data) return null;

  const completed = data.tasks.filter((t) => t.completed).length;
  const total = data.tasks.length;

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground gap-2" onClick={onBack}>
        &larr; Back to users
      </Button>
      <div className="mb-6">
        <h2 className="text-xl font-serif font-semibold">{date}</h2>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-muted-foreground">
            {completed}/{total} tasks completed
          </span>
          {data.submitted && (
            <Badge variant="secondary" className="text-xs">
              Submitted
            </Badge>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {data.tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
          >
            {task.completed ? (
              <CheckCircle2 size={18} className="text-primary shrink-0" />
            ) : (
              <Circle size={18} className="text-muted-foreground shrink-0" />
            )}
            <span className={task.completed ? "line-through text-muted-foreground" : "text-foreground"}>
              {task.text}
            </span>
          </div>
        ))}
        {data.tasks.length === 0 && (
          <p className="text-muted-foreground text-sm py-4 text-center">No tasks for this day.</p>
        )}
      </div>
    </div>
  );
}

// --- Report tab ---------------------------------------------------------

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Pull "#tag" tokens out of a task title.
function extractTags(text: string): string[] {
  const out: string[] = [];
  const re = /#([\p{L}\p{N}_-]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].toLowerCase());
  return out;
}

function ReportTab() {
  const [from, setFrom] = useState<string>(daysAgoKey(6));
  const [to, setTo] = useState<string>(todayKey());
  const [submittedRange, setSubmittedRange] = useState<{ from: string; to: string } | null>(null);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["admin-report", submittedRange?.from, submittedRange?.to],
    queryFn: () => fetchAdminReport(submittedRange!.from, submittedRange!.to),
    enabled: !!submittedRange,
  });

  const summary = useMemo(() => {
    if (!data) return null;
    let totalTasks = 0;
    let completedTasks = 0;
    let postedTasks = 0;
    const byUser = new Map<
      string,
      { name: string; total: number; done: number; posted: number }
    >();
    const tagCounts = new Map<string, number>();

    for (const day of data.days) {
      const u =
        byUser.get(day.userId) ?? { name: day.userName, total: 0, done: 0, posted: 0 };
      for (const t of day.tasks) {
        totalTasks += 1;
        u.total += 1;
        if (t.completed) {
          completedTasks += 1;
          u.done += 1;
        }
        if (t.postedForFuture) {
          postedTasks += 1;
          u.posted += 1;
        }
        for (const tag of extractTags(t.text)) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
      byUser.set(day.userId, u);
    }

    const tags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    const users = Array.from(byUser.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return { totalTasks, completedTasks, postedTasks, tags, users };
  }, [data]);

  const handleRun = () => {
    if (!from || !to) return;
    if (from > to) return;
    setSubmittedRange({ from, to });
  };

  const handlePrint = () => window.print();

  return (
    <div className="space-y-6">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText size={16} className="text-muted-foreground" />
            Date-range report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="report-from" className="text-xs">
                From
              </Label>
              <Input
                id="report-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[170px]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-to" className="text-xs">
                To
              </Label>
              <Input
                id="report-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[170px]"
              />
            </div>
            <Button onClick={handleRun} disabled={isFetching || !from || !to || from > to}>
              <Send className="w-4 h-4 mr-2" />
              {isFetching ? "Loading..." : "Run report"}
            </Button>
            {data && (
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-2" />
                Print / save PDF
              </Button>
            )}
            {data && (
              <Button variant="ghost" onClick={() => refetch()} disabled={isFetching}>
                Refresh
              </Button>
            )}
          </div>
          {from > to && (
            <p className="text-xs text-destructive mt-2">"From" must be on or before "To".</p>
          )}
          {error && (
            <p className="text-xs text-destructive mt-2">{(error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      {data && summary && (
        <div id="admin-report-printable" className="space-y-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-serif font-semibold">
              Report: {data.from} &rarr; {data.to}
            </h2>
            <span className="text-xs text-muted-foreground">
              {data.days.length} day{data.days.length === 1 ? "" : "s"} · generated{" "}
              {new Date().toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="py-4">
                <div className="text-xs text-muted-foreground">Total tasks</div>
                <div className="text-2xl font-semibold">{summary.totalTasks}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-2xl font-semibold">
                  {summary.completedTasks}
                  <span className="text-sm text-muted-foreground ml-2">
                    {summary.totalTasks
                      ? `(${Math.round((summary.completedTasks / summary.totalTasks) * 100)}%)`
                      : ""}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <div className="text-xs text-muted-foreground">Posted for future</div>
                <div className="text-2xl font-semibold">{summary.postedTasks}</div>
              </CardContent>
            </Card>
          </div>

          {summary.users.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">By user</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="px-4 py-2">User</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Completed</th>
                      <th className="px-4 py-2 text-right">Posted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.users.map((u) => (
                      <tr key={u.name} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">{u.name}</td>
                        <td className="px-4 py-2 text-right">{u.total}</td>
                        <td className="px-4 py-2 text-right">{u.done}</td>
                        <td className="px-4 py-2 text-right">{u.posted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {summary.tags.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {summary.tags.map(({ tag, count }) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      #{tag}
                      <span className="ml-1 opacity-60">{count}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Day-by-day</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.days.length === 0 && (
                <p className="text-sm text-muted-foreground">No data in this range.</p>
              )}
              {data.days.map((day) => {
                const done = day.tasks.filter((t) => t.completed).length;
                return (
                  <div key={day.listId} className="border border-border rounded-md p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{day.date}</span>
                        <span className="text-xs text-muted-foreground">{day.userName}</span>
                        {day.submitted && (
                          <Badge variant="secondary" className="text-xs">
                            Submitted
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {done}/{day.tasks.length} done
                      </span>
                    </div>
                    {day.tasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No tasks.</p>
                    ) : (
                      <ul className="space-y-1">
                        {day.tasks.map((t) => (
                          <li
                            key={t.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            {t.completed ? (
                              <CheckCircle2 size={14} className="mt-0.5 text-primary shrink-0" />
                            ) : (
                              <Circle size={14} className="mt-0.5 text-muted-foreground shrink-0" />
                            )}
                            <span
                              className={
                                t.completed
                                  ? "line-through text-muted-foreground"
                                  : "text-foreground"
                              }
                            >
                              {t.text}
                            </span>
                            {t.postedForFuture && (
                              <Badge variant="outline" className="text-[10px] ml-1">
                                Posted
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Print stylesheet: only render the report area when printing. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #admin-report-printable, #admin-report-printable * { visibility: visible !important; }
          #admin-report-printable { position: absolute; inset: 0; padding: 1rem; }
        }
      `}</style>
    </div>
  );
}

// --- Users tab (existing) -----------------------------------------------

function UsersTab() {
  const [selected, setSelected] = useState<{ userId: string; date: string } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchAdminUsers,
  });

  if (selected) {
    return (
      <TaskDetailPanel
        userId={selected.userId}
        date={selected.date}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <>
      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}

      {data?.users.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Users size={32} className="mx-auto mb-3 opacity-30" />
          <p>No user data yet.</p>
        </div>
      )}

      <div className="space-y-6">
        {data?.users.map((user) => (
          <Card key={user.userId} className="overflow-hidden">
            <CardHeader className="pb-3 bg-muted/30">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Users size={16} className="text-muted-foreground" />
                {user.displayName}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {user.dates.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelected({ userId: user.userId, date: entry.date })}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/40 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{entry.date}</span>
                      {entry.submitted && (
                        <Badge variant="secondary" className="text-xs">
                          Submitted
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {entry.completedCount}/{entry.totalCount} done
                      </span>
                      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{
                            width: entry.totalCount
                              ? `${(entry.completedCount / entry.totalCount) * 100}%`
                              : "0%",
                          }}
                        />
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function AdminPanel() {
  const isAdmin = useIsAdmin();
  if (!isAdmin) return <Redirect to="/app" />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 print:hidden">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-serif font-semibold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Browse user submissions or run a date-range report.
          </p>
        </div>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="mb-4 print:hidden">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="report">
          <ReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
