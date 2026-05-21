import { useQuery } from "@tanstack/react-query";

async function checkAdmin(): Promise<{ isAdmin: boolean }> {
  const res = await fetch("/api/admin/check", { credentials: "include" });
  if (!res.ok) return { isAdmin: false };
  return res.json();
}

export function useIsAdmin() {
  const { data } = useQuery({
    queryKey: ["admin-check"],
    queryFn: checkAdmin,
    staleTime: 60_000,
  });
  return data?.isAdmin ?? false;
}
