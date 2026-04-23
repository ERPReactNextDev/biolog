"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { type DateRange } from "react-day-picker";

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

import { Received } from "@/components/tickets";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TicketRaiseSuggestion } from "@/components/ticket-raise-suggestion";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";

interface UserDetails {
  UserId: string;
  Firstname: string;
  Lastname: string;
  Email: string;
  Role: string;
  department: string;
  Company?: string;
  referenceid: string;
  profilePicture?: string;
}

export default function Page() {
  const searchParams = useSearchParams();
  const { userId, setUserId } = useUser();

  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);

  const [loadingUser, setLoadingUser] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateCreatedFilterRange, setDateCreatedFilterRange] = useState<
    DateRange | undefined
  >(undefined);

  // Load date filter range from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("dateCreatedFilterRange");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.from) parsed.from = new Date(parsed.from);
        if (parsed?.to) parsed.to = new Date(parsed.to);
        setDateCreatedFilterRange(parsed);
      }
    } catch {
      // ignore JSON parse errors
    }
  }, []);

  // Save date filter range to localStorage on change
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

  const queryUserId = searchParams?.get("id") ?? "";

  // Sync userId from query param to context
  useEffect(() => {
    if (queryUserId && queryUserId !== userId) {
      setUserId(queryUserId);
    }
  }, [queryUserId, userId, setUserId]);

  // Fetch user details when userId changes
  useEffect(() => {
    const fetchUserData = async () => {
      if (!queryUserId) {
        setError("User ID is missing.");
        setUserDetails(null);
        return;
      }
      setError(null);
      setLoadingUser(true);
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
          department: data.Department ?? "",
          Company: data.Company ?? "",
          referenceid: data.ReferenceID ?? "",
          profilePicture: data.profilePicture ?? "",
        });
      } catch (err) {
        setError("Failed to load user data.");
        setUserDetails(null);
      } finally {
        setLoadingUser(false);
      }
    };

    fetchUserData();
  }, [queryUserId]);

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
                      <BreadcrumbPage>Tickets</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </header>

              <main className="flex flex-1 flex-col gap-4 p-4 overflow-auto">
                {loadingUser && <p>Loading user data...</p>}
                {error && <p className="text-red-500">{error}</p>}

                {!loadingUser && userDetails && (
                  <>
                    <TicketRaiseSuggestion />
                    <Received
                      referenceid={userDetails.referenceid}
                      department={userDetails.department}
                      fullname={`${userDetails.Firstname} ${userDetails.Lastname}`.trim()}
                    />
                  </>
                )}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </FormatProvider>
      </UserProvider>
    </ProtectedPageWrapper>
  );
}
