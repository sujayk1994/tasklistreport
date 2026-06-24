import { useQuery } from "@tanstack/react-query";

async function checkAdmin(): Promise<{ isAdmin: boolean; isSubAdmin: boolean }> {
  const res = await fetch("/api/admin/check", { credentials: "include" });
  if (!res.ok) return { isAdmin: false, isSubAdmin: false };
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

export function useIsSubAdmin() {
  const { data } = useQuery({
    queryKey: ["admin-check"],
    queryFn: checkAdmin,
    staleTime: 60_000,
  });
  return data?.isSubAdmin ?? false;
}

export function useAdminRole() {
  const { data } = useQuery({
    queryKey: ["admin-check"],
    queryFn: checkAdmin,
    staleTime: 60_000,
  });
  return {
    isAdmin: data?.isAdmin ?? false,
    isSubAdmin: data?.isSubAdmin ?? false,
    hasAnyAdminAccess: (data?.isAdmin ?? false) || (data?.isSubAdmin ?? false),
  };
}
