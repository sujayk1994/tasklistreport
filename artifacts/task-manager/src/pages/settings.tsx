import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetSettings,
  getGetSettingsQueryKey,
  useUpdateSettings,
  useSendTestEmail,
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
} from "lucide-react";
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
    gmailUserSet: boolean;
    gmailPassSet: boolean;
    gmailUserMasked: string | null;
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

  const updateSettings = useUpdateSettings();
  const sendTestEmail = useSendTestEmail();

  const [diagnostics, setDiagnostics] = useState<EmailDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

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

  useEffect(() => {
    void refreshDiagnostics();
    // initial load only — user refreshes manually after that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Pull the fresh diagnostics so the panel reflects this attempt.
        void refreshDiagnostics();
      },
      onError: (err: any) => {
        const msg =
          err?.data?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Failed to send test email";
        toast.error(msg);
        void refreshDiagnostics();
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

      {/*
        TEMPORARY DIAGNOSTICS PANEL
        Remove this whole <Card> (and the diagnostics route on the server)
        once the email send is verified working in production.
      */}
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
                    ok={diagnostics.env.gmailUserSet}
                    label="GMAIL_USER set"
                    detail={diagnostics.env.gmailUserMasked ?? "(not set)"}
                  />
                  <DiagRow
                    ok={diagnostics.env.gmailPassSet}
                    label="GMAIL_APP_PASSWORD set"
                    detail={
                      diagnostics.env.gmailPassSet
                        ? "(value hidden)"
                        : "(not set)"
                    }
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
