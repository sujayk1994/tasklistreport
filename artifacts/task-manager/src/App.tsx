import { useState, useEffect, useRef } from "react";
import { ClerkProvider, SignIn, Show, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";

import Landing from "@/pages/landing";
import AppView from "@/pages/app";
import HistoryList from "@/pages/history";
import HistoryDate from "@/pages/history-date";
import Settings from "@/pages/settings";
import AdminPanel from "@/pages/admin";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      {/* To update login providers, app branding, or OAuth settings go to https://dashboard.clerk.com */}
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={undefined}
        appearance={{
          elements: {
            socialButtonsBlockButton: { display: "none" },
            socialButtonsProviderIcon: { display: "none" },
            dividerRow: { display: "none" },
            footerAction: { display: "none" },
            socialButtons: { display: "none" },
          },
        }}
      />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function ProtectedRoute({
  component: Component,
  bleed,
}: {
  component: any;
  bleed?: boolean;
}) {
  return (
    <>
      <Show when="signed-in">
        <Layout bleed={bleed}>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes({ publishableKey, proxyUrl }: { publishableKey: string; proxyUrl?: string }) {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={proxyUrl || undefined}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?"><Redirect to="/sign-in" /></Route>
          
          <Route path="/app">
            <ProtectedRoute component={AppView} bleed />
          </Route>
          <Route path="/history">
            <ProtectedRoute component={HistoryList} />
          </Route>
          <Route path="/history/:date">
            <ProtectedRoute component={HistoryDate} />
          </Route>
          <Route path="/settings">
            <ProtectedRoute component={Settings} />
          </Route>
          <Route path="/admin">
            <ProtectedRoute component={AdminPanel} />
          </Route>

          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

interface ClerkConfig {
  clerkPublishableKey: string;
  clerkProxyUrl: string;
}

function App() {
  const [clerkConfig, setClerkConfig] = useState<ClerkConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: ClerkConfig) => {
        if (!data.clerkPublishableKey) {
          setError("CLERK_PUBLISHABLE_KEY is not configured on the server.");
        } else {
          setClerkConfig(data);
        }
      })
      .catch(() => setError("Failed to load app configuration."));
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (!clerkConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes
          publishableKey={clerkConfig.clerkPublishableKey}
          proxyUrl={clerkConfig.clerkProxyUrl || undefined}
        />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
