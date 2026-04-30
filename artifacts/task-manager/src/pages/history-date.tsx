import { useRoute, Link } from "wouter";
import { useGetTasksByDate, getGetTasksByDateQueryKey } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Loader2, ArrowLeft, Check, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HistoryDate() {
  const [, params] = useRoute("/history/:date");
  const date = params?.date || "";

  const { data: taskList, isLoading, error } = useGetTasksByDate(date, {
    query: {
      enabled: !!date,
      queryKey: getGetTasksByDateQueryKey(date)
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !taskList) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-muted-foreground mb-4">Could not load tasks for this date.</p>
        <Link href="/history">
          <Button variant="outline">Back to History</Button>
        </Link>
      </div>
    );
  }

  const dateObj = parseISO(taskList.date);
  const formattedDate = format(dateObj, "EEEE, MMMM d, yyyy");
  const completedCount = taskList.tasks.filter(t => t.completed).length;
  const totalCount = taskList.tasks.length;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <Link href="/history" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors group">
        <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
        Back to History
      </Link>

      <div className="flex items-end justify-between border-b border-border/50 pb-6">
        <div>
          <h1 className="text-3xl font-serif tracking-tight mb-2">{formattedDate}</h1>
          <p className="text-muted-foreground text-sm font-medium">
            {completedCount} of {totalCount} tasks completed
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full">
          <Check size={14} />
          Submitted
        </div>
      </div>

      <div className="space-y-3">
        {taskList.tasks.map((task) => (
          <div 
            key={task.id} 
            className={`flex items-start gap-4 p-4 rounded-lg border ${
              task.completed 
                ? 'bg-muted/30 border-transparent' 
                : 'bg-card border-border/60 shadow-sm opacity-60'
            }`}
          >
            <div className={`mt-1 flex items-center justify-center w-5 h-5 rounded-sm border ${
              task.completed ? 'bg-primary border-primary text-primary-foreground' : 'border-input bg-background'
            }`}>
              {task.completed && <CheckSquare className="w-3.5 h-3.5" />}
            </div>
            <div className={`flex-1 text-base leading-relaxed ${
              task.completed ? 'text-muted-foreground line-through' : 'text-foreground'
            }`}>
              {task.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
