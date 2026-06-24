import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminRole } from "@/hooks/use-admin";
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
  LayoutDashboard,
  ArrowLeft,
  Plus,
  X,
  UserPlus,
  Eye,
  EyeOff,
  Clock,
  CheckCheck,
  AlertCircle,
  MapPin,
  RefreshCw,
  Trash2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type UserEntry = {
  userId: string;
  displayName: string;
  isSubAdmin: boolean;
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

type BoardTask = {
  id: number;
  text: string;
  completed: boolean;
  note: string | null;
  position: number;
};
type UserBoard = {
  id?: number;
  date: string;
  submitted: boolean;
  userId?: string;
  tasks: BoardTask[];
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

async function fetchUserBoard(userId: string): Promise<UserBoard> {
  const res = await fetch(
    `/api/admin/users/${encodeURIComponent(userId)}/board`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to fetch user board");
  return res.json();
}

async function fetchMyTasks(): Promise<{ tasks: BoardTask[] }> {
  const res = await fetch("/api/tasks/today", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch my tasks");
  return res.json();
}

async function fetchAdminBoard(): Promise<{
  adminUserId: string;
  adminDisplayName: string;
  date: string;
  submitted: boolean;
  tasks: BoardTask[];
}> {
  const res = await fetch("/api/admin/my-board", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch admin board");
  return res.json();
}

async function deleteUser(userId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Failed to delete user");
  return json;
}

async function setUserRole(userId: string, role: "subAdmin" | null): Promise<{ success: boolean }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Failed to update role");
  return json;
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

async function createUser(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}): Promise<{ success: boolean; userId: string; email: string; displayName: string }> {
  const res = await fetch("/api/admin/create-user", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Failed to create user");
  return json;
}

async function assignTasksToUser(userId: string, tasks: string[]): Promise<{ success: boolean; inserted: number }> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/assign-tasks`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "Failed to assign tasks");
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

// --- Board tab components -----------------------------------------------

function UserBoardView({ userId, displayName, onBack }: { userId: string; displayName: string; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-board", userId],
    queryFn: () => fetchUserBoard(userId),
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="text-muted-foreground text-sm py-8 text-center">Loading board...</div>;

  const tasks = data?.tasks ?? [];
  const completed = tasks.filter((t) => t.completed).length;
  const pending = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground gap-2" onClick={onBack}>
        <ArrowLeft size={14} /> Back to boards
      </Button>

      <div className="mb-6">
        <h2 className="text-xl font-serif font-semibold">{displayName}'s Board</h2>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-muted-foreground">
            Today · {completed}/{tasks.length} completed
          </span>
          {data?.submitted && (
            <Badge variant="secondary" className="text-xs">Submitted</Badge>
          )}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <LayoutDashboard size={32} className="mx-auto mb-3 opacity-30" />
          <p>No tasks for today yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Pending ({pending.length})
              </h3>
              <div className="space-y-2">
                {pending.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
                  >
                    <Circle size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{task.text}</p>
                      {task.note && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{task.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Completed ({done.length})
              </h3>
              <div className="space-y-2">
                {done.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card opacity-70"
                  >
                    <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-through text-muted-foreground">{task.text}</p>
                      {task.note && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{task.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssignTasksPanel({ users, isSubAdmin = false }: { users: UserEntry[]; isSubAdmin?: boolean }) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [customTask, setCustomTask] = useState("");
  const [customTasks, setCustomTasks] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { data: myTasksData, isLoading: myTasksLoading } = useQuery({
    queryKey: ["admin-my-tasks"],
    queryFn: isSubAdmin ? fetchAdminBoard : fetchMyTasks,
    refetchInterval: 60000,
  });

  const rawTasks = isSubAdmin
    ? ((myTasksData as any)?.tasks ?? [])
    : ((myTasksData as any)?.tasks ?? []);
  const myTasks = (rawTasks as BoardTask[]).filter((t) => !t.completed);
  const boardLabel = isSubAdmin ? "admin's board" : "your board";

  const assignMutation = useMutation({
    mutationFn: ({ userId, tasks }: { userId: string; tasks: string[] }) =>
      assignTasksToUser(userId, tasks),
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-board", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setSuccessMsg(`${data.inserted} task(s) assigned successfully.`);
      setSelectedTaskIds(new Set());
      setCustomTasks([]);
      setCustomTask("");
      setTimeout(() => setSuccessMsg(null), 4000);
    },
  });

  const toggleTask = (id: number) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addCustomTask = () => {
    const text = customTask.trim();
    if (!text) return;
    setCustomTasks((prev) => [...prev, text]);
    setCustomTask("");
  };

  const removeCustomTask = (idx: number) => {
    setCustomTasks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAssign = () => {
    if (!selectedUserId) return;
    const fromBoard = myTasks
      .filter((t) => selectedTaskIds.has(t.id))
      .map((t) => t.text);
    const allTasks = [...fromBoard, ...customTasks];
    if (allTasks.length === 0) return;
    assignMutation.mutate({ userId: selectedUserId, tasks: allTasks });
  };

  const totalSelected = selectedTaskIds.size + customTasks.length;
  const selectedUser = users.find((u) => u.userId === selectedUserId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users size={16} className="text-muted-foreground" />
            Select target user
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {users.map((u) => (
              <button
                key={u.userId}
                onClick={() => setSelectedUserId(u.userId)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedUserId === u.userId
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border hover:bg-muted"
                }`}
              >
                {u.displayName}
              </button>
            ))}
          </div>
          {users.length === 0 && (
            <p className="text-sm text-muted-foreground">No users found.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select from {boardLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {myTasksLoading ? (
            <p className="text-sm text-muted-foreground">Loading tasks...</p>
          ) : myTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending tasks on {boardLabel} today.</p>
          ) : (
            <div className="space-y-2">
              {myTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => toggleTask(task.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    selectedTaskIds.has(task.id)
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/40"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      selectedTaskIds.has(task.id)
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {selectedTaskIds.has(task.id) && (
                      <CheckCircle2 size={12} className="text-primary-foreground" />
                    )}
                  </div>
                  <span className="text-sm">{task.text}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Or add custom tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Textarea
              placeholder="Type a task to assign..."
              value={customTask}
              onChange={(e) => setCustomTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  addCustomTask();
                }
              }}
              className="resize-none min-h-[60px] flex-1"
            />
            <Button variant="outline" size="sm" onClick={addCustomTask} className="self-start mt-1">
              <Plus size={14} />
            </Button>
          </div>
          {customTasks.length > 0 && (
            <div className="space-y-1.5">
              {customTasks.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-md border border-primary/20 bg-primary/5"
                >
                  <span className="text-sm flex-1">{t}</span>
                  <button onClick={() => removeCustomTask(i)} className="text-muted-foreground hover:text-destructive">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleAssign}
          disabled={!selectedUserId || totalSelected === 0 || assignMutation.isPending}
          className="gap-2"
        >
          <Send size={14} />
          {assignMutation.isPending
            ? "Assigning..."
            : `Assign ${totalSelected > 0 ? `${totalSelected} task${totalSelected > 1 ? "s" : ""}` : "tasks"} to ${selectedUser?.displayName ?? "user"}`}
        </Button>
        {totalSelected > 0 && (
          <span className="text-sm text-muted-foreground">{totalSelected} task(s) selected</span>
        )}
      </div>

      {assignMutation.error && (
        <p className="text-sm text-destructive">{(assignMutation.error as Error).message}</p>
      )}
      {successMsg && (
        <p className="text-sm text-green-600 font-medium">{successMsg}</p>
      )}
    </div>
  );
}

function BoardsTab({ isSubAdmin = false }: { isSubAdmin?: boolean }) {
  const [view, setView] = useState<"list" | "board" | "assign">("list");
  const [selectedUser, setSelectedUser] = useState<UserEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchAdminUsers,
  });

  const { data: adminBoardData } = useQuery({
    queryKey: ["admin-my-board"],
    queryFn: fetchAdminBoard,
    enabled: isSubAdmin,
    refetchInterval: 30000,
  });

  const users = data?.users ?? [];

  if (isSubAdmin && view === "list") {
    const adminTasks = adminBoardData?.tasks ?? [];
    const pending = adminTasks.filter((t) => !t.completed);
    const done = adminTasks.filter((t) => t.completed);
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-serif font-semibold">{adminBoardData?.adminDisplayName ?? "Admin"}'s Board</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Today · {done.length}/{adminTasks.length} completed
              {adminBoardData?.submitted && (
                <Badge variant="secondary" className="text-xs ml-2">Submitted</Badge>
              )}
            </p>
          </div>
          <Button onClick={() => setView("assign")} className="gap-2">
            <Plus size={14} /> Assign Tasks to Admin
          </Button>
        </div>
        {adminTasks.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <LayoutDashboard size={32} className="mx-auto mb-3 opacity-30" />
            <p>No tasks for today yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {pending.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Pending ({pending.length})
                </h3>
                <div className="space-y-2">
                  {pending.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                      <Circle size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{task.text}</p>
                        {task.note && <p className="text-xs text-muted-foreground mt-1 italic">{task.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {done.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Completed ({done.length})
                </h3>
                <div className="space-y-2">
                  {done.map((task) => (
                    <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card opacity-70">
                      <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm line-through text-muted-foreground">{task.text}</p>
                        {task.note && <p className="text-xs text-muted-foreground mt-1 italic">{task.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (view === "board" && selectedUser) {
    return (
      <UserBoardView
        userId={selectedUser.userId}
        displayName={selectedUser.displayName}
        onBack={() => { setView("list"); setSelectedUser(null); }}
      />
    );
  }

  if (view === "assign") {
    const adminUserId = adminBoardData?.adminUserId;
    const adminDisplayName = adminBoardData?.adminDisplayName ?? "Admin";
    const assignUsers = isSubAdmin && adminUserId
      ? [{ userId: adminUserId, displayName: adminDisplayName, dates: [] }]
      : users;

    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 text-muted-foreground gap-2"
          onClick={() => setView("list")}
        >
          <ArrowLeft size={14} /> Back to boards
        </Button>
        <div className="mb-4">
          <h2 className="text-xl font-serif font-semibold">Assign Tasks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isSubAdmin
              ? `Pick tasks from ${adminDisplayName}'s board or write new ones, then assign them to ${adminDisplayName}.`
              : "Pick tasks from your board or write new ones, then assign them to a user's today list."}
          </p>
        </div>
        <AssignTasksPanel users={assignUsers} isSubAdmin={isSubAdmin} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-serif font-semibold">User Boards</h2>
          <p className="text-sm text-muted-foreground mt-1">View any user's live board for today.</p>
        </div>
        <Button onClick={() => setView("assign")} className="gap-2">
          <Plus size={14} /> Assign Tasks
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && users.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Users size={32} className="mx-auto mb-3 opacity-30" />
          <p>No users found.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((user) => {
          const todayEntry = user.dates[0];
          return (
            <Card
              key={user.userId}
              className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => { setSelectedUser(user); setView("board"); }}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate">{user.displayName}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {todayEntry ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">Today</span>
                      {todayEntry.submitted && (
                        <Badge variant="secondary" className="text-[10px]">Submitted</Badge>
                      )}
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mb-1">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: todayEntry.totalCount
                            ? `${(todayEntry.completedCount / todayEntry.totalCount) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {todayEntry.completedCount}/{todayEntry.totalCount} done
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No activity today</p>
                )}
                <div className="mt-3 flex items-center justify-end">
                  <span className="text-xs text-primary font-medium flex items-center gap-1">
                    View board <ChevronRight size={12} />
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
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

// --- Create User Dialog -------------------------------------------------

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createUser,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setSuccessMsg(`User "${data.displayName}" created successfully.`);
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 2000);
    },
  });

  const handleClose = () => {
    if (mutation.isPending) return;
    mutation.reset();
    setSuccessMsg(null);
    setEmail("");
    setPassword("");
    setFirstName("");
    setLastName("");
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ email, password, firstName, lastName });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus size={18} className="text-primary" />
            Create New User
          </DialogTitle>
        </DialogHeader>

        {successMsg ? (
          <div className="py-6 text-center">
            <CheckCircle2 size={36} className="text-green-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-green-700">{successMsg}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cu-first">First name</Label>
                <Input
                  id="cu-first"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cu-last">Last name</Label>
                <Input
                  id="cu-last"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cu-email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cu-email"
                type="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cu-password">
                Password <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="cu-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {mutation.error && (
              <p className="text-sm text-destructive">
                {(mutation.error as Error).message}
              </p>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || !email || !password}>
                <UserPlus size={14} className="mr-1.5" />
                {mutation.isPending ? "Creating..." : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Users tab ----------------------------------------------------------

function DeleteUserDialog({
  user,
  open,
  onClose,
}: {
  user: UserEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteUser(user!.userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onClose();
    },
  });

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 size={16} /> Delete User
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to permanently delete{" "}
            <span className="font-semibold text-foreground">{user.displayName}</span>?
            This will remove them from Clerk and delete all their task history.
          </p>
          <p className="text-sm font-medium text-destructive">This action cannot be undone.</p>
          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            <Trash2 size={14} className="mr-1.5" />
            {mutation.isPending ? "Deleting..." : "Delete user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<{ userId: string; date: string } | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserEntry | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: fetchAdminUsers,
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "subAdmin" | null }) =>
      setUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
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
      <CreateUserDialog open={showCreateUser} onClose={() => setShowCreateUser(false)} />
      <DeleteUserDialog
        user={deleteTarget}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />

      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.users.length} user${data.users.length !== 1 ? "s" : ""}` : ""}
        </p>
        <Button onClick={() => setShowCreateUser(true)} className="gap-2">
          <UserPlus size={14} />
          Create user
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}

      {!isLoading && data?.users.length === 0 && (
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
                <span className="flex-1">{user.displayName}</span>
                {user.isSubAdmin && (
                  <Badge variant="secondary" className="text-xs gap-1 font-normal">
                    <ShieldCheck size={11} />
                    Sub-Admin
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 px-2 text-xs gap-1 ${
                    user.isSubAdmin
                      ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    roleMutation.mutate({
                      userId: user.userId,
                      role: user.isSubAdmin ? null : "subAdmin",
                    });
                  }}
                  disabled={roleMutation.isPending}
                  title={user.isSubAdmin ? "Remove sub-admin role" : "Make sub-admin"}
                >
                  {user.isSubAdmin ? (
                    <><ShieldOff size={13} /> Remove</>
                  ) : (
                    <><ShieldCheck size={13} /> Sub-Admin</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(user); }}
                  title="Delete user"
                >
                  <Trash2 size={14} />
                </Button>
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

type PrintQueueItem = {
  id: number;
  magazine: string;
  project: string;
  tmCompletedAt: string;
  hoursElapsed: number;
  hoursRemaining: number;
  addressReceived: boolean;
  addressCopies: number | null;
  addressReceivedAt: string | null;
  addressId: number | null;
  status: "no_address" | "waiting_24h" | "ready";
};

type PendingAddress = {
  id: number;
  magazine: string;
  project: string;
  copies: number;
  receivedAt: string;
};

type ProjectTrackerRow = {
  magazine: string;
  project: string;
  reprintReceiptDate: string;
  onlineDate: string;
  reprintDone: boolean;
  reprintDoneDate: string | null;
  tmDone: boolean;
  tmDoneDate: string | null;
  addressDone: boolean;
  addressDoneDate: string | null;
  shippingDone: boolean;
  shippingDoneDate: string | null;
};

function PrintQueueTab() {
  const queryClient = useQueryClient();
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [triggerSuccess, setTriggerSuccess] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<{
    queue: PrintQueueItem[];
    pendingAddresses: PendingAddress[];
  }>({
    queryKey: ["admin-print-queue"],
    queryFn: async () => {
      const r = await fetch("/api/admin/print-queue");
      if (!r.ok) throw new Error("Failed to load print queue");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const triggerMutation = useMutation({
    mutationFn: async ({ magazine, project }: { magazine: string; project: string }) => {
      const r = await fetch("/api/admin/print-queue/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magazine, project }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Failed to trigger print task");
      return body as { taskText: string; copies: number; tasksInserted: number };
    },
    onSuccess: (data) => {
      setTriggerError(null);
      setTriggerSuccess(`Created "${data.taskText}" for ${data.tasksInserted} user(s).`);
      queryClient.invalidateQueries({ queryKey: ["admin-print-queue"] });
      setTimeout(() => setTriggerSuccess(null), 6000);
    },
    onError: (err: Error) => {
      setTriggerSuccess(null);
      setTriggerError(err.message);
      setTimeout(() => setTriggerError(null), 8000);
    },
  });

  const deleteTmMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/print-queue/tm/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-print-queue"] });
    },
  });

  const deleteAddressMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/print-queue/address/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-print-queue"] });
    },
  });

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const statusBadge = (item: PrintQueueItem) => {
    if (item.status === "ready")
      return (
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
          <CheckCheck size={11} /> Ready — creating soon
        </Badge>
      );
    if (item.status === "waiting_24h")
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1">
          <Clock size={11} /> {item.hoursRemaining.toFixed(1)}h remaining
        </Badge>
      );
    return (
      <Badge className="bg-slate-100 text-slate-600 border-slate-200 gap-1">
        <AlertCircle size={11} /> Waiting for address
      </Badge>
    );
  };

  if (isLoading)
    return <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>;

  const { queue = [], pendingAddresses = [] } = data ?? {};
  const isTriggering = triggerMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Print Task Queue</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tracks Twitter Marketing completions waiting for their Print task to be created (24 h after completion + address required).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {triggerSuccess && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          <CheckCheck size={14} />
          {triggerSuccess}
        </div>
      )}
      {triggerError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={14} />
          {triggerError}
        </div>
      )}

      {queue.length === 0 && pendingAddresses.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No pending print tasks right now.
          </CardContent>
        </Card>
      ) : (
        <>
          {queue.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Twitter Marketing Completions ({queue.length})
              </h3>
              {queue.map((item, i) => (
                <Card key={i} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{item.magazine}</span>
                          <span className="text-muted-foreground text-sm">—</span>
                          <span className="text-sm text-muted-foreground">{item.project}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <CheckCheck size={11} />
                            TM completed {fmt(item.tmCompletedAt)} ({item.hoursElapsed.toFixed(1)}h ago)
                          </span>
                          {item.addressReceived ? (
                            <span className="flex items-center gap-1 text-emerald-600">
                              <MapPin size={11} />
                              Address received {item.addressReceivedAt ? fmt(item.addressReceivedAt) : ""} · {item.addressCopies} copies
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-slate-400">
                              <MapPin size={11} />
                              No address yet
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {statusBadge(item)}
                        {item.addressReceived && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/5"
                            disabled={isTriggering}
                            onClick={() =>
                              triggerMutation.mutate({
                                magazine: item.magazine,
                                project: item.project,
                              })
                            }
                          >
                            <Printer size={11} />
                            Force Create
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                          disabled={deleteTmMutation.isPending}
                          title="Delete from queue"
                          onClick={() => {
                            if (confirm(`Delete queue entry for ${item.magazine} — ${item.project}?`)) {
                              deleteTmMutation.mutate(item.id);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                    {item.status === "waiting_24h" && (
                      <div className="mt-3">
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>{item.hoursElapsed.toFixed(1)}h elapsed</span>
                          <span>24h window</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all"
                            style={{ width: `${Math.min(100, (item.hoursElapsed / 24) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {pendingAddresses.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Address Receipts Without TM Completion ({pendingAddresses.length})
              </h3>
              {pendingAddresses.map((addr, i) => (
                <Card key={i}>
                  <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{addr.magazine}</span>
                        <span className="text-muted-foreground text-sm">—</span>
                        <span className="text-sm text-muted-foreground">{addr.project}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {addr.copies} copies · received {fmt(addr.receivedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="bg-blue-50 text-blue-600 border-blue-200 gap-1">
                        <Clock size={11} /> Waiting for TM completion
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                        disabled={deleteAddressMutation.isPending}
                        title="Delete address receipt"
                        onClick={() => {
                          if (confirm(`Delete address receipt for ${addr.magazine} — ${addr.project}?`)) {
                            deleteAddressMutation.mutate(addr.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProjectTrackerTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<{ rows: ProjectTrackerRow[] }>({
    queryKey: ["admin-project-tracker"],
    queryFn: async () => {
      const r = await fetch("/api/admin/project-tracker");
      if (!r.ok) throw new Error("Failed to load project tracker");
      return r.json();
    },
    refetchInterval: 120_000,
  });

  function fmtDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  const DoneCell = ({ done, date }: { done: boolean; date: string | null }) => (
    <div className="flex flex-col gap-0.5">
      <Badge
        className={
          done
            ? "bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 w-fit"
            : "bg-slate-100 text-slate-500 border-slate-200 gap-1 w-fit"
        }
      >
        {done ? <CheckCheck size={10} /> : <Clock size={10} />}
        {done ? "Done" : "Pending"}
      </Badge>
      {done && date && (
        <span className="text-[10px] text-muted-foreground">{fmtDate(date)}</span>
      )}
    </div>
  );

  if (isLoading)
    return <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>;

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Project Tracker</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lifecycle view for each project: Online → Reprint → Twitter Marketing → Address → Shipping.
            Populated automatically from email ingest and task completions.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No projects tracked yet. Data populates once Reprint Reminder emails are processed.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground w-10">#</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Project</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground whitespace-nowrap">Online Date</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Reprint</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground whitespace-nowrap">Twitter Marketing</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Address</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Shipping</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-3 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-sm leading-tight">{row.project}</div>
                    <div className="text-xs text-muted-foreground">{row.magazine}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-0.5">
                      <Badge className="bg-blue-100 text-blue-700 border-blue-200 gap-1 w-fit">
                        <CheckCheck size={10} /> Online
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{fmtDate(row.onlineDate)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <DoneCell done={row.reprintDone} date={row.reprintDoneDate} />
                  </td>
                  <td className="px-3 py-3">
                    <DoneCell done={row.tmDone} date={row.tmDoneDate} />
                  </td>
                  <td className="px-3 py-3">
                    <DoneCell done={row.addressDone} date={row.addressDoneDate} />
                  </td>
                  <td className="px-3 py-3">
                    <DoneCell done={row.shippingDone} date={row.shippingDoneDate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ManualProjectRow = {
  id: number;
  magazine: string;
  project: string;
  copies: number;
  createdAt: string;
  reprintTaskCreated: boolean;
  reprintTaskCreatedAt: string | null;
  reprintCompletedAt: string | null;
  twitterTaskCreated: boolean;
  twitterTaskCreatedAt: string | null;
};

function ManualProjectsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [magazine, setMagazine] = useState("");
  const [project, setProject] = useState("");
  const [copies, setCopies] = useState("1");
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<{ projects: ManualProjectRow[] }>({
    queryKey: ["admin-manual-projects"],
    queryFn: async () => {
      const r = await fetch("/api/admin/manual-projects", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { magazine: string; project: string; copies: number }) => {
      const r = await fetch("/api/admin/manual-projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || "Failed to create");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-manual-projects"] });
      setShowForm(false);
      setMagazine(""); setProject(""); setCopies("1"); setFormError(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/admin/manual-projects/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-manual-projects"] }),
  });

  function fmt(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function stepStatus(proj: ManualProjectRow) {
    if (proj.twitterTaskCreated) return "complete";
    if (proj.reprintCompletedAt) return "twitter-pending";
    if (proj.reprintTaskCreated) return "reprint-done";
    return "reprint-pending";
  }

  const projects = data?.projects ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Manual Projects</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Register a project manually. After 2 days a Reprint task is auto-created; 2 days after
            Reprint completion a Twitter Marketing task fires. Emails for these projects are ignored.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setShowForm(true); setFormError(null); }}>
            <Plus size={13} />
            Add Project
          </Button>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { setShowForm(o); setFormError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Manual Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Magazine</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Agribiotech"
                value={magazine}
                onChange={(e) => setMagazine(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Project</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Eclipse Automation"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Copies</Label>
              <Input
                className="mt-1"
                type="number"
                min="1"
                placeholder="1"
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </div>
            {formError && <p className="text-xs text-red-500">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              disabled={createMutation.isPending || !magazine.trim() || !project.trim()}
              onClick={() => {
                const copiesNum = parseInt(copies, 10);
                if (isNaN(copiesNum) || copiesNum < 1) { setFormError("Copies must be a positive number"); return; }
                createMutation.mutate({ magazine: magazine.trim(), project: project.trim(), copies: copiesNum });
              }}
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No manual projects yet. Click "Add Project" to register one.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Project</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Copies</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Registered</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Reprint Task</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Reprint Done</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground">Twitter Task</th>
                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground w-10"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((proj) => {
                const status = stepStatus(proj);
                return (
                  <tr key={proj.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-3">
                      <div className="font-medium text-sm leading-tight">{proj.project}</div>
                      <div className="text-xs text-muted-foreground">{proj.magazine}</div>
                    </td>
                    <td className="px-3 py-3 text-sm">{proj.copies}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{fmt(proj.createdAt)}</td>
                    <td className="px-3 py-3">
                      {proj.reprintTaskCreated ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 w-fit">
                            <CheckCheck size={10} /> Created
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{fmt(proj.reprintTaskCreatedAt)}</span>
                        </div>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1 w-fit">
                          <Clock size={10} /> Pending (2d)
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {proj.reprintCompletedAt ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 w-fit">
                            <CheckCheck size={10} /> Done
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{fmt(proj.reprintCompletedAt)}</span>
                        </div>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-slate-200 gap-1 w-fit">
                          <Clock size={10} /> Not yet
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {proj.twitterTaskCreated ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 w-fit">
                            <CheckCheck size={10} /> Created
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{fmt(proj.twitterTaskCreatedAt)}</span>
                        </div>
                      ) : status === "reprint-done" || status === "twitter-pending" ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1 w-fit">
                          <Clock size={10} /> Pending (2d)
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-500 border-slate-200 gap-1 w-fit">
                          <Clock size={10} /> Waiting
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                        disabled={deleteMutation.isPending}
                        title="Delete project"
                        onClick={() => {
                          if (confirm(`Delete manual project "${proj.project}" (${proj.magazine})?`)) {
                            deleteMutation.mutate(proj.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const { isAdmin, isSubAdmin, hasAnyAdminAccess } = useAdminRole();
  if (!hasAnyAdminAccess) return <Redirect to="/app" />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 print:hidden">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-serif font-semibold">
            {isSubAdmin ? "Sub-Admin Panel" : "Admin Panel"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isSubAdmin
              ? "View admin's board and assign tasks."
              : "Browse user submissions, view boards, assign tasks, or run a date-range report."}
          </p>
        </div>
      </div>

      {isSubAdmin ? (
        <Tabs defaultValue="boards" className="w-full">
          <TabsList className="mb-4 print:hidden">
            <TabsTrigger value="boards">Board &amp; Assign</TabsTrigger>
          </TabsList>
          <TabsContent value="boards">
            <BoardsTab isSubAdmin={true} />
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="users" className="w-full">
          <TabsList className="mb-4 print:hidden">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="boards">Boards</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="print-queue">Print Queue</TabsTrigger>
            <TabsTrigger value="project-tracker">Project Tracker</TabsTrigger>
            <TabsTrigger value="manual-projects">Manual Projects</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="boards">
            <BoardsTab />
          </TabsContent>
          <TabsContent value="report">
            <ReportTab />
          </TabsContent>
          <TabsContent value="print-queue">
            <PrintQueueTab />
          </TabsContent>
          <TabsContent value="project-tracker">
            <ProjectTrackerTab />
          </TabsContent>
          <TabsContent value="manual-projects">
            <ManualProjectsTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
