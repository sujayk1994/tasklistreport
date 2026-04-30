import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetSettings, getGetSettingsQueryKey, useUpdateSettings, useSendTestEmail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Mail, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const settingsSchema = z.object({
  recipientEmails: z.string().optional().default("")
});

type SettingsValues = z.infer<typeof settingsSchema>;

export default function Settings() {
  const queryClient = useQueryClient();
  
  const { data: settings, isLoading } = useGetSettings({
    query: {
      queryKey: getGetSettingsQueryKey()
    }
  });

  const updateSettings = useUpdateSettings();
  const sendTestEmail = useSendTestEmail();

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      recipientEmails: ""
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        recipientEmails: settings.recipientEmails || ""
      });
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
        }
      }
    );
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
            Configure who receives a summary of your completed tasks when you submit your day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="recipientEmails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient Emails</FormLabel>
                    <FormControl>
                      <Input placeholder="email@example.com, another@example.com" {...field} />
                    </FormControl>
                    <FormDescription>
                      Comma-separated list of email addresses. Leave blank to disable reports.
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
                  onClick={() => {
                    sendTestEmail.mutate(undefined, {
                      onSuccess: (res: { success?: boolean; message?: string } | undefined) => {
                        if (res?.success === false) {
                          toast.error(res.message || "Failed to send test email");
                        } else {
                          toast.success(res?.message || "Test email sent");
                        }
                      },
                      onError: (err: any) => {
                        const msg =
                          err?.data?.message ||
                          err?.response?.data?.message ||
                          err?.message ||
                          "Failed to send test email";
                        toast.error(msg);
                      },
                    });
                  }}
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
                  disabled={updateSettings.isPending || !form.formState.isDirty}
                  className="min-w-[100px]"
                >
                  {updateSettings.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Save Changes
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                "Test Submit" sends a sample of today's report to the recipients above without
                marking the day as submitted.
              </p>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
