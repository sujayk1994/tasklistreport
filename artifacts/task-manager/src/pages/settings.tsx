import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetSettings,
  getGetSettingsQueryKey,
  useUpdateSettings,
  useSendTestEmail,
  useSetCheckedIn,
  getGetTodayTasksQueryKey,
  useGetTodayTasks,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Send,
  Stethoscope,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  FileOutput,
  Zap,
  LogIn,
  Plus,
  Trash2,
  Pencil,
  X,
  Inbox,
  Sparkles,
  FlaskConical,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useReportMode, type ReportMode } from "@/lib/reportMode";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DIAGNOSTICS_VISIBLE_KEY = "settings:diagnosticsVisible";

const settingsSchema = z.object({
  recipientEmails: z.string().optional().default(""),
});

type SettingsValues = z.infer<typeof settingsSchema>;

// ---------------------------------------------------------------------------
// Diagnostic types — these mirror the shape returned by GET /api/diagnostics/email
// (see artifacts/api-server/src/routes/diagnostics.ts). The whole
// "Email diagnostics" card on this page is a temporary aid the user asked
// for to debug why their report email isn't going out. Delete this section
// (and the matching server route) once email is verified working.
// ---------------------------------------------------------------------------

type EmailAttempt = {
  attemptedAt: string;
  kind: "submit" | "test";
  success: boolean;
  message: string;
  recipientsRaw: string;
  recipientsParsed: string[];
  taskCount: number;
  durationMs: number;
  errorName?: string;
  errorCode?: string;
  errorMessage?: string;
};

type EmailDiagnostics = {
  serverTime: string;
  env: {
    provider: string;
    apiKeySet: boolean;
    apiKeyMasked: string | null;
    fromAddress: string;
    fromAddressFromEnv: boolean;
  };
  lastAttempt: EmailAttempt | null;
};

async function fetchEmailDiagnostics(): Promise<EmailDiagnostics> {
  const res = await fetch("/api/diagnostics/email", {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Diagnostics request failed (HTTP ${res.status})`);
  }
  return (await res.json()) as EmailDiagnostics;
}

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });

  const { data: taskList } = useGetTodayTasks({
    query: { queryKey: getGetTodayTasksQueryKey() },
  });

  const updateSettings = useUpdateSettings();
  const sendTestEmail = useSendTestEmail();
  const setCheckedInMutation = useSetCheckedIn();

  const [reportMode, setReportModeValue] = useReportMode();

  const [diagnostics, setDiagnostics] = useState<EmailDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DIAGNOSTICS_VISIBLE_KEY) === "true";
  });

  const refreshDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      const data = await fetchEmailDiagnostics();
      setDiagnostics(data);
    } catch (err: any) {
      setDiagnosticsError(err?.message ?? "Failed to load diagnostics");
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  // Only fetch diagnostics when the panel is actually visible — no point
  // hitting the endpoint if the user has the panel turned off.
  useEffect(() => {
    if (diagnosticsVisible) {
      void refreshDiagnostics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticsVisible]);

  const handleToggleDiagnostics = (next: boolean) => {
    setDiagnosticsVisible(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DIAGNOSTICS_VISIBLE_KEY, String(next));
    }
  };

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { recipientEmails: "" },
  });

  useEffect(() => {
    if (settings) {
      form.reset({ recipientEmails: settings.recipientEmails || "" });
    }
  }, [settings, form]);

  const onSubmit = (values: SettingsValues) => {
    updateSettings.mutate(
      { data: { recipientEmails: values.recipientEmails || "" } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetSettingsQueryKey(), data);
          toast.success("Settings saved successfully");
        },
        onError: () => {
          toast.error("Failed to save settings");
        },
      },
    );
  };

  const handleTestSubmit = () => {
    sendTestEmail.mutate(undefined, {
      onSuccess: (res: { success?: boolean; message?: string } | undefined) => {
        if (res?.success === false) {
          toast.error(res.message || "Failed to send test email");
        } else {
          toast.success(res?.message || "Test email sent");
        }
        if (diagnosticsVisible) void refreshDiagnostics();
      },
      onError: (err: any) => {
        const msg =
          err?.data?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Failed to send test email";
        toast.error(msg);
        if (diagnosticsVisible) void refreshDiagnostics();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-serif tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your app preferences.</p>
      </div>

      <Card className="border-border/60 bg-card/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="w-5 h-5 text-primary" />
            Daily Reports
          </CardTitle>
          <CardDescription>
            Configure who receives a summary of your completed tasks when you
            submit your day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-6"
            >
              <FormField
                control={form.control}
                name="recipientEmails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient Emails</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="email@example.com, another@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Comma-separated list of email addresses. Leave blank to
                      disable reports.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={sendTestEmail.isPending}
                  onClick={handleTestSubmit}
                >
                  {sendTestEmail.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Test Submit
                </Button>
                <Button
                  type="submit"
                  disabled={
                    updateSettings.isPending || !form.formState.isDirty
                  }
                  className="min-w-[100px]"
                >
                  {updateSettings.isPending && (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  )}
                  Save Changes
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                "Test Submit" sends a sample of today's report to the
                recipients above without marking the day as submitted.
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileOutput className="w-5 h-5 text-primary" />
            Send report
          </CardTitle>
          <CardDescription>
            Choose what happens when you press <b>Submit Day</b>. Email sends
            the report to the recipients above; Download saves it as an HTML
            file you can open or print to PDF.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReportModeSelector value={reportMode} onChange={setReportModeValue} />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Automation card                                                      */}
      {/* ------------------------------------------------------------------ */}
      <Card className="border-border/60 bg-card/60 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="w-5 h-5 text-primary" />
            Automation
          </CardTitle>
          <CardDescription>
            Control how automatic check-in and auto-submit work. Disable both
            on holidays so no email ever goes out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Auto check-in toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <LogIn className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <Label htmlFor="auto-checkin-toggle" className="text-sm font-medium cursor-pointer">
                  Auto check-in when app loads
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When on, opening the app marks you as working today and
                  enables auto-submit. Turn off to stay unchecked-in (e.g. on
                  holidays).
                </p>
              </div>
            </div>
            <Switch
              id="auto-checkin-toggle"
              checked={settings?.autoCheckIn ?? true}
              disabled={updateSettings.isPending}
              onCheckedChange={(val) => {
                updateSettings.mutate(
                  { data: { autoCheckIn: val } },
                  {
                    onSuccess: (data) => {
                      queryClient.setQueryData(getGetSettingsQueryKey(), data);
                      toast.success(
                        val
                          ? "Auto check-in enabled"
                          : "Auto check-in disabled — open the app won't trigger emails",
                      );
                    },
                    onError: () => toast.error("Failed to update setting"),
                  },
                );
              }}
            />
          </div>

          <div className="border-t border-border/40" />

          {/* Auto-submit toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Zap className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <Label htmlFor="auto-submit-toggle" className="text-sm font-medium cursor-pointer">
                  Auto-submit at 11:59 PM
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When on, the server automatically submits your day and sends
                  the email at 11:59 PM if you haven't done it manually. Only
                  fires on days you checked in.
                </p>
              </div>
            </div>
            <Switch
              id="auto-submit-toggle"
              checked={settings?.autoSubmit ?? true}
              disabled={updateSettings.isPending}
              onCheckedChange={(val) => {
                updateSettings.mutate(
                  { data: { autoSubmit: val } },
                  {
                    onSuccess: (data) => {
                      queryClient.setQueryData(getGetSettingsQueryKey(), data);
                      toast.success(
                        val
                          ? "Auto-submit enabled"
                          : "Auto-submit disabled — you must submit manually",
                      );
                    },
                    onError: () => toast.error("Failed to update setting"),
                  },
                );
              }}
            />
          </div>

          <div className="border-t border-border/40" />

          {/* Work days picker */}
          <div className="flex items-start gap-3">
            <div className="w-4 mt-0.5 shrink-0 text-muted-foreground text-xs font-bold text-center">M</div>
            <div className="flex-1">
              <Label className="text-sm font-medium block mb-1.5">
                Work days
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                Auto check-in and auto-submit are skipped on days not selected
                here. Saturday and Sunday are off by default.
              </p>
              <WorkDaysPicker
                value={settings?.workDays ?? "1,2,3,4,5"}
                disabled={updateSettings.isPending}
                onChange={(val) => {
                  updateSettings.mutate(
                    { data: { workDays: val } },
                    {
                      onSuccess: (data) => {
                        queryClient.setQueryData(getGetSettingsQueryKey(), data);
                        toast.success("Work days saved");
                      },
                      onError: () => toast.error("Failed to update work days"),
                    },
                  );
                }}
              />
            </div>
          </div>

          <div className="border-t border-border/40" />

          {/* Today's check-in status — manual override */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  (taskList as any)?.checkedIn
                    ? "text-blue-500"
                    : "text-muted-foreground"
                }`}
              />
              <div>
                <Label htmlFor="today-checkin-toggle" className="text-sm font-medium cursor-pointer">
                  Today's check-in{" "}
                  <span
                    className={`text-xs font-normal rounded-full px-1.5 py-0.5 ${
                      (taskList as any)?.checkedIn
                        ? "bg-blue-100 text-blue-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {(taskList as any)?.checkedIn ? "Checked in" : "Not checked in"}
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manually override today's check-in status. Turn off to
                  cancel auto-submit for today even if you've already opened
                  the app.
                </p>
              </div>
            </div>
            <Switch
              id="today-checkin-toggle"
              checked={!!(taskList as any)?.checkedIn}
              disabled={setCheckedInMutation.isPending || !taskList}
              onCheckedChange={(val) => {
                setCheckedInMutation.mutate(
                  { data: { checkedIn: val } },
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({
                        queryKey: getGetTodayTasksQueryKey(),
                      });
                      toast.success(
                        val
                          ? "Checked in for today — auto-submit will fire at 11:59 PM"
                          : "Checked out for today — auto-submit cancelled",
                      );
                    },
                    onError: () => toast.error("Failed to update check-in"),
                  },
                );
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/*
        TEMPORARY DIAGNOSTICS PANEL
        Remove this whole block (and the diagnostics route on the server)
        once the email send is verified working in production.
      */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <Stethoscope className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <Label
              htmlFor="diagnostics-toggle"
              className="text-sm font-medium cursor-pointer"
            >
              Show email diagnostics{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (temporary)
              </span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Surfaces the last submit / test email result so failures are
              visible.
            </p>
          </div>
        </div>
        <Switch
          id="diagnostics-toggle"
          checked={diagnosticsVisible}
          onCheckedChange={handleToggleDiagnostics}
        />
      </div>

      <InboxRulesCard />

      {diagnosticsVisible && (
      <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Stethoscope className="w-5 h-5 text-amber-600" />
                Email Diagnostics{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (temporary)
                </span>
              </CardTitle>
              <CardDescription>
                Shows the result of the most recent submit / test email so we
                can see exactly why a send failed.
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={refreshDiagnostics}
              disabled={diagnosticsLoading}
            >
              {diagnosticsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {diagnosticsError && (
            <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/40 p-3 text-red-800 dark:text-red-200">
              {diagnosticsError}
            </div>
          )}

          {diagnostics && (
            <>
              <div>
                <div className="font-semibold mb-1">Server config</div>
                <ul className="space-y-1">
                  <DiagRow
                    ok={true}
                    label="Provider"
                    detail={diagnostics.env.provider}
                  />
                  <DiagRow
                    ok={diagnostics.env.apiKeySet}
                    label="RESEND_API_KEY set"
                    detail={diagnostics.env.apiKeyMasked ?? "(not set)"}
                  />
                  <DiagRow
                    ok={true}
                    label="From address"
                    detail={`${diagnostics.env.fromAddress}${diagnostics.env.fromAddressFromEnv ? "" : " (default — set EMAIL_FROM to override)"}`}
                  />
                </ul>
              </div>

              <div>
                <div className="font-semibold mb-1">Last attempt</div>
                {diagnostics.lastAttempt ? (
                  <div className="rounded border border-border bg-background/60 p-3 space-y-1.5">
                    <DiagLine
                      label="When"
                      value={new Date(
                        diagnostics.lastAttempt.attemptedAt,
                      ).toLocaleString()}
                    />
                    <DiagLine
                      label="Kind"
                      value={diagnostics.lastAttempt.kind}
                    />
                    <DiagLine
                      label="Result"
                      value={
                        diagnostics.lastAttempt.success
                          ? "success"
                          : "failed"
                      }
                      valueClass={
                        diagnostics.lastAttempt.success
                          ? "text-green-700 dark:text-green-400 font-medium"
                          : "text-red-700 dark:text-red-400 font-medium"
                      }
                    />
                    <DiagLine
                      label="Duration"
                      value={`${diagnostics.lastAttempt.durationMs} ms`}
                    />
                    <DiagLine
                      label="Tasks"
                      value={String(diagnostics.lastAttempt.taskCount)}
                    />
                    <DiagLine
                      label="Recipients (raw)"
                      value={
                        diagnostics.lastAttempt.recipientsRaw || "(empty)"
                      }
                    />
                    <DiagLine
                      label="Recipients (parsed)"
                      value={
                        diagnostics.lastAttempt.recipientsParsed.length > 0
                          ? diagnostics.lastAttempt.recipientsParsed.join(
                              ", ",
                            )
                          : "(none — no valid addresses)"
                      }
                    />
                    <DiagLine
                      label="Message"
                      value={diagnostics.lastAttempt.message}
                      valueClass={
                        diagnostics.lastAttempt.success
                          ? ""
                          : "text-red-700 dark:text-red-400"
                      }
                    />
                    {diagnostics.lastAttempt.errorName && (
                      <DiagLine
                        label="Error name"
                        value={diagnostics.lastAttempt.errorName}
                      />
                    )}
                    {diagnostics.lastAttempt.errorCode && (
                      <DiagLine
                        label="Error code"
                        value={diagnostics.lastAttempt.errorCode}
                      />
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">
                    No attempts yet. Click "Test Submit" or submit a day to
                    populate this.
                  </div>
                )}
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Raw JSON
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              </details>
            </>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox Rules management (admin-only)
// ---------------------------------------------------------------------------

type InboxRule = {
  id: number;
  label: string;
  subjectPattern: string;
  parserType: "reminder" | "pending_list" | "shipment" | "ad_request";
  taskSuffix: string | null;
  enabled: boolean;
};

const PARSER_LABELS: Record<InboxRule["parserType"], string> = {
  reminder: "Reminder (sent today: … Best regards)",
  pending_list: "Pending list (numbered lines)",
  shipment: "Shipment copies summary",
  ad_request: "Ad request (Hi name, → task + details note)",
};

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function InboxRulesCard() {
  const [rules, setRules] = useState<InboxRule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [seeding, setSeeding] = useState(false);

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const data = await apiFetch("/api/admin/inbox-rules/seed-defaults", { method: "POST" });
      const count = (data as any).seeded as number;
      if (count === 0) {
        toast.info("All default rules already exist.");
      } else {
        toast.success(`Added ${count} default rule${count === 1 ? "" : "s"}.`);
        await load();
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to seed defaults");
    } finally {
      setSeeding(false);
    }
  };

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addPattern, setAddPattern] = useState("");
  const [addType, setAddType] = useState<InboxRule["parserType"]>("pending_list");
  const [addSuffix, setAddSuffix] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const [editLabel, setEditLabel] = useState("");
  const [editPattern, setEditPattern] = useState("");
  const [editSuffix, setEditSuffix] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [testingId, setTestingId] = useState<number | null>(null);
  const [testBody, setTestBody] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{ tasks: string[]; parseNote: string | null } | null>(null);

  const handleTest = async (id: number) => {
    if (!testBody.trim()) return;
    setTestRunning(true);
    setTestResult(null);
    try {
      const data = await apiFetch(`/api/admin/inbox-rules/${id}/test`, {
        method: "POST",
        body: JSON.stringify({ body: testBody }),
      });
      setTestResult({ tasks: (data as any).tasks as string[], parseNote: (data as any).parseNote as string | null });
    } catch (err: any) {
      toast.error(err?.message ?? "Test failed");
    } finally {
      setTestRunning(false);
    }
  };

  const openTest = (id: number) => {
    if (testingId === id) { setTestingId(null); setTestResult(null); setTestBody(""); return; }
    setTestingId(id);
    setTestResult(null);
    setTestBody("");
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch("/api/admin/inbox-rules");
      setRules((data as any).rules as InboxRule[]);
    } catch (err: any) {
      setLoadError(err?.message ?? "Failed to load rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleToggle = async (rule: InboxRule) => {
    try {
      const data = await apiFetch(`/api/admin/inbox-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      setRules((prev) => prev?.map((r) => r.id === rule.id ? (data as any).rule : r) ?? null);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update rule");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/api/admin/inbox-rules/${id}`, { method: "DELETE" });
      setRules((prev) => prev?.filter((r) => r.id !== id) ?? null);
      toast.success("Rule deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete rule");
    }
  };

  const startEdit = (rule: InboxRule) => {
    setEditingId(rule.id);
    setEditLabel(rule.label);
    setEditPattern(rule.subjectPattern);
    setEditSuffix(rule.taskSuffix ?? "");
  };

  const saveEdit = async (id: number) => {
    setEditSaving(true);
    try {
      const data = await apiFetch(`/api/admin/inbox-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          label: editLabel,
          subjectPattern: editPattern,
          taskSuffix: editSuffix || null,
        }),
      });
      setRules((prev) => prev?.map((r) => r.id === id ? (data as any).rule : r) ?? null);
      setEditingId(null);
      toast.success("Rule updated");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update rule");
    } finally {
      setEditSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!addLabel.trim() || !addPattern.trim()) return;
    setAddSaving(true);
    try {
      const data = await apiFetch("/api/admin/inbox-rules", {
        method: "POST",
        body: JSON.stringify({
          label: addLabel,
          subjectPattern: addPattern,
          parserType: addType,
          taskSuffix: addSuffix || null,
        }),
      });
      setRules((prev) => [...(prev ?? []), (data as any).rule as InboxRule]);
      setAddOpen(false);
      setAddLabel(""); setAddPattern(""); setAddSuffix(""); setAddType("pending_list");
      toast.success("Rule added");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to add rule");
    } finally {
      setAddSaving(false);
    }
  };

  if (loadError?.includes("403") || loadError?.includes("Forbidden")) return null;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Inbox className="w-5 h-5 text-primary" />
              Inbox email rules
            </CardTitle>
            <CardDescription>
              Subject patterns that trigger automatic task creation from
              incoming emails. When rules are saved here they replace the
              built-in defaults.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSeedDefaults}
              disabled={seeding}
              title="Pre-populate with the 4 built-in default rules"
            >
              {seeding
                ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                : <Sparkles className="w-4 h-4 mr-1.5" />}
              Seed defaults
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen((v) => !v)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add rule
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {loadError && !loadError.includes("403") && (
          <div className="text-sm text-red-600 dark:text-red-400">{loadError}</div>
        )}

        {/* Add form */}
        {addOpen && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New rule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Design Pending List"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Subject pattern (regex)</Label>
                <Input
                  value={addPattern}
                  onChange={(e) => setAddPattern(e.target.value)}
                  placeholder="design\s+pending\s+list"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Parser type</Label>
                <Select value={addType} onValueChange={(v) => setAddType(v as InboxRule["parserType"])}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PARSER_LABELS) as InboxRule["parserType"][]).map((k) => (
                      <SelectItem key={k} value={k}>{PARSER_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {addType === "reminder" && (
                <div className="space-y-1">
                  <Label className="text-xs">Task suffix <span className="text-muted-foreground">(appended to each task)</span></Label>
                  <Input
                    value={addSuffix}
                    onChange={(e) => setAddSuffix(e.target.value)}
                    placeholder="twitter marketing"
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                <X className="w-3.5 h-3.5 mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                disabled={addSaving || !addLabel.trim() || !addPattern.trim()}
                onClick={handleAdd}
              >
                {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        )}

        {/* Rule list */}
        {rules && rules.length === 0 && !addOpen && (
          <p className="text-sm text-muted-foreground italic">
            No rules yet — built-in defaults are active. Add a rule above to
            take control.
          </p>
        )}
        {rules?.map((rule) => (
          <div
            key={rule.id}
            className={cn(
              "rounded-lg border p-3 space-y-2 transition-colors",
              rule.enabled ? "border-border bg-card" : "border-border/40 bg-muted/30 opacity-60",
            )}
          >
            {editingId === rule.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Subject pattern (regex)</Label>
                    <Input value={editPattern} onChange={(e) => setEditPattern(e.target.value)} className="h-8 text-sm font-mono" />
                  </div>
                  {rule.parserType === "reminder" && (
                    <div className="space-y-1">
                      <Label className="text-xs">Task suffix</Label>
                      <Input value={editSuffix} onChange={(e) => setEditSuffix(e.target.value)} className="h-8 text-sm" placeholder="e.g. twitter marketing" />
                    </div>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    <X className="w-3.5 h-3.5 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" disabled={editSaving} onClick={() => saveEdit(rule.id)}>
                    {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{rule.label}</span>
                    <span className="text-xs rounded-full px-2 py-0.5 bg-primary/10 text-primary font-mono">
                      {PARSER_LABELS[rule.parserType]?.split(" ")[0]}
                    </span>
                    {rule.taskSuffix && (
                      <span className="text-xs text-muted-foreground">suffix: <code className="bg-muted px-1 rounded">{rule.taskSuffix}</code></span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{rule.subjectPattern}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={() => handleToggle(rule)}
                    className="scale-75"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn("w-7 h-7", testingId === rule.id && "bg-accent")}
                    title="Test this rule with a sample email body"
                    onClick={() => openTest(rule.id)}
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => startEdit(rule)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" onClick={() => handleDelete(rule.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Inline test panel */}
              {testingId === rule.id && (
                <div className="mt-2 rounded-md border border-dashed border-border bg-muted/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <FlaskConical className="w-3 h-3" /> Test — paste a sample email body
                  </p>
                  <textarea
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono leading-relaxed resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    rows={6}
                    placeholder={
                      rule.parserType === "reminder"
                        ? "sent today:\nBrand Name - Project Title\n  - Sub item\nBest regards,"
                        : rule.parserType === "pending_list"
                        ? "1. First task\n2. Second task\n--\nSignature"
                        : rule.parserType === "ad_request"
                        ? "Hi Sujay,\n\nPlease design a full page ad for the below company.\n\nCompany Name\n4115 Some Street\nCity, State 00000"
                        : "Magazine: Vogue\nProject: Spring Issue\n500"
                    }
                    value={testBody}
                    onChange={(e) => { setTestBody(e.target.value); setTestResult(null); }}
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <Button
                      size="sm"
                      disabled={testRunning || !testBody.trim()}
                      onClick={() => handleTest(rule.id)}
                    >
                      {testRunning
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                        : <FlaskConical className="w-3.5 h-3.5 mr-1" />}
                      Run test
                    </Button>
                  </div>

                  {testResult && (
                    <div className="space-y-1.5 pt-1">
                      {testResult.parseNote && (
                        <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2 text-xs text-amber-800 dark:text-amber-200">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          {testResult.parseNote}
                        </div>
                      )}
                      {testResult.tasks.length > 0 && (
                        <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-2 space-y-1">
                          <p className="text-xs font-semibold text-green-800 dark:text-green-200">
                            {testResult.tasks.length} task{testResult.tasks.length !== 1 ? "s" : ""} would be created:
                          </p>
                          <ul className="space-y-0.5">
                            {testResult.tasks.map((t, i) => (
                              <li key={i} className="text-xs font-mono text-green-900 dark:text-green-100 flex items-start gap-1.5">
                                <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-green-600" />
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReportModeSelector({
  value,
  onChange,
}: {
  value: ReportMode;
  onChange: (v: ReportMode) => void;
}) {
  const options: {
    value: ReportMode;
    label: string;
    description: string;
    icon: typeof Mail;
  }[] = [
    {
      value: "email",
      label: "Email",
      description: "Send to recipients above",
      icon: Mail,
    },
    {
      value: "download",
      label: "Download",
      description: "Save report as HTML file",
      icon: Download,
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Send report mode"
      className="grid grid-cols-2 gap-3"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors",
              "hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card",
            )}
          >
            <div className="flex items-center gap-2">
              <Icon
                className={cn(
                  "w-4 h-4",
                  selected ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  selected ? "text-foreground" : "text-foreground/90",
                )}
              >
                {opt.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{opt.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work days day-of-week toggle picker
// ---------------------------------------------------------------------------
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function WorkDaysPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (val: string) => void;
}) {
  const selected = new Set(
    value
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n)),
  );

  const toggle = (dow: number) => {
    const next = new Set(selected);
    if (next.has(dow)) {
      next.delete(dow);
    } else {
      next.add(dow);
    }
    onChange([0, 1, 2, 3, 4, 5, 6].filter((d) => next.has(d)).join(","));
  };

  return (
    <div className="flex gap-1.5 flex-wrap">
      {DOW_LABELS.map((label, dow) => {
        const on = selected.has(dow);
        return (
          <button
            key={dow}
            type="button"
            disabled={disabled}
            onClick={() => toggle(dow)}
            className={cn(
              "w-10 h-10 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-border hover:bg-accent",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function DiagRow({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
      )}
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">— {detail}</span>
    </li>
  );
}

function DiagLine({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="grid grid-cols-[140px,1fr] gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={`break-words ${valueClass}`}>{value}</div>
    </div>
  );
}
