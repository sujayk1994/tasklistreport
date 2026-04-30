import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <CheckCircle2 size={14} />
          </div>
          <span className="font-serif font-medium tracking-tight">Daily Tasks</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in">
            <Button className="text-sm font-medium">Log in</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center max-w-2xl mx-auto">
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-700 fade-in">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-medium tracking-tight text-foreground">
            A quiet space for<br />your daily focus.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Write down what you need to do today. Check them off. Close the day. A simple, honest record of your accomplishments.
          </p>
          <div className="pt-4">
            <Link href="/sign-in">
              <Button size="lg" className="text-base px-8 h-12 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
                Log in to get started
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
