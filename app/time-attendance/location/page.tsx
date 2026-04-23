"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { type DateRange } from "react-day-picker";
import { toast } from "sonner";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import "leaflet/dist/leaflet.css";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";

// Dynamically import LocationMap (no SSR)
const LocationMap = dynamic(() => import("@/components/location-map"), {
  ssr: false,
});

interface ActivityLog {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  Location: string;
  date_created: string;
  Latitude?: number;
  Longitude?: number;
  PhotoURL?: string;
  Remarks: string;
  _id?: string;
}

interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
}

interface UserDetails {
  UserId: string;
  Firstname: string;
  Lastname: string;
  Email: string;
  Role: string;
  Department: string;
  Company?: string;
  ReferenceID: string;
  profilePicture?: string;
}

function toLocalDateKey(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Page() {
  const searchParams = useSearchParams();
  const { userId, setUserId } = useUser();

  const queryUserId = searchParams?.get("id") ?? "";

  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dateCreatedFilterRange, setDateCreatedFilterRange] = useState<
    DateRange | undefined
  >(undefined);

  const [posts, setPosts] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [usersMap, setUsersMap] = useState<Record<string, UserInfo>>({});
  const [pagination, setPagination] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  } | null>(null);

  // Load stored date range from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("dateCreatedFilterRange");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.from) parsed.from = new Date(parsed.from);
        if (parsed?.to) parsed.to = new Date(parsed.to);
        setDateCreatedFilterRange(parsed);
      }
    } catch { }
  }, []);

  // Save date range to localStorage
  useEffect(() => {
    if (dateCreatedFilterRange) {
      localStorage.setItem(
        "dateCreatedFilterRange",
        JSON.stringify(dateCreatedFilterRange)
      );
    } else {
      localStorage.removeItem("dateCreatedFilterRange");
    }
  }, [dateCreatedFilterRange]);

  // Set userId from query param
  useEffect(() => {
    if (queryUserId && queryUserId !== userId) {
      setUserId(queryUserId);
    }
  }, [queryUserId, userId, setUserId]);

  // Fetch user details
  useEffect(() => {
    if (!queryUserId) {
      setError("User ID is missing.");
      return;
    }
    setError(null);

    const fetchUserData = async () => {
      try {
        const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
        if (!res.ok) throw new Error("Failed to fetch user data");
        const data = await res.json();

        setUserDetails({
          UserId: data._id ?? "",
          Firstname: data.Firstname ?? "",
          Lastname: data.Lastname ?? "",
          Email: data.Email ?? "",
          Role: data.Role ?? "",
          Department: data.Department ?? "",
          Company: data.Company ?? "",
          ReferenceID: data.ReferenceID ?? "",
          profilePicture: data.profilePicture ?? "",
        });
      } catch (err) {
        setError("Failed to load user data.");
      }
    };

    fetchUserData();
  }, [queryUserId]);

  // Fetch activity logs from API
  useEffect(() => {
    const fetchAllActivityLogs = async () => {
      if (!userDetails) return;
      setLoading(true);

      try {
        let allLogs: ActivityLog[] = [];
        let page = 1;
        const limit = 100;
        let totalPages = 1;

        do {
          const params = new URLSearchParams();
          params.append("page", page.toString());
          params.append("limit", limit.toString());
          params.append("role", userDetails.Role);

          if (
            userDetails.Role !== "SuperAdmin" &&
            userDetails.Role !== "Human Resources"
          ) {
            params.append("referenceID", userDetails.ReferenceID);
          }

          if (dateCreatedFilterRange?.from) {
            params.append("startDate", dateCreatedFilterRange.from.toISOString());
            params.append(
              "endDate",
              (dateCreatedFilterRange.to ?? dateCreatedFilterRange.from).toISOString()
            );
          }

          const res = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
          if (!res.ok) throw new Error("Failed to fetch logs");

          const data = await res.json();
          allLogs = allLogs.concat(data.data ?? []);

          totalPages = data.pagination?.totalPages ?? 1;
          page++;
        } while (page <= totalPages);

        setPosts(allLogs);
      } catch (err) {
        toast.error("Error fetching activity logs.");
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAllActivityLogs();
  }, [userDetails, dateCreatedFilterRange]);

  // Fetch users info for posts
  useEffect(() => {
    const fetchUsersForPosts = async () => {
      if (posts.length === 0) return;

      const uniqueRefs = Array.from(new Set(posts.map((p) => p.ReferenceID)));

      try {
        const res = await fetch(`/api/users?referenceIDs=${uniqueRefs.join(",")}`);
        if (!res.ok) throw new Error("Failed to fetch users");
        const usersData = await res.json();

        const map: Record<string, UserInfo> = {};
        usersData.forEach((user: any) => {
          map[user.ReferenceID] = {
            Firstname: user.Firstname,
            Lastname: user.Lastname,
            profilePicture: user.profilePicture,
          };
        });

        setUsersMap(map);
      } catch (err) {
      }
    };

    fetchUsersForPosts();
  }, [posts]);

  // Filter posts for location only
  const postsWithLocation = useMemo(() => {
    return posts.filter((p) => p.Latitude !== undefined && p.Longitude !== undefined);
  }, [posts]);

  if (error) return <p className="p-4 text-red-600">{error}</p>;
  if (!userDetails) return <p className="p-4">Loading user details...</p>;

  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <FormatProvider>
          <SidebarProvider>
            <AppSidebar
              userId={userId ?? undefined}
              dateCreatedFilterRange={dateCreatedFilterRange}
              setDateCreatedFilterRangeAction={setDateCreatedFilterRange}
            />
            <SidebarInset>
              <header className="bg-background sticky top-0 flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>Location Map</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </header>

              <main className="flex-1 p-4 h-[calc(100vh-64px)]">
                {loading && <p>Loading activity logs...</p>}

                {!loading && postsWithLocation.length === 0 && (
                  <p>No data available for your account in this date range.</p>
                )}

                {!loading && postsWithLocation.length > 0 && (
                  <LocationMap
                    postsWithLocation={postsWithLocation}
                    usersMap={usersMap}
                  />
                )}

                <style jsx global>{`
                  .leaflet-pane {
                    z-index: 0 !important;
                  }
                `}</style>
              </main>
            </SidebarInset>
          </SidebarProvider>
        </FormatProvider>
      </UserProvider>
    </ProtectedPageWrapper>
  );
}
