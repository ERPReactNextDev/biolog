"use client";


import * as React from 'react';
import { Plus, LayoutDashboard, FileText, Clock, MapPin, Briefcase, Users, CalendarCheck } from "lucide-react";

import { Calendars } from "@/components/calendars";
import { DatePicker } from "@/components/date-picker";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import { type DateRange } from "react-day-picker";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

import { Button } from "@/components/ui/button";
import Link from "next/link";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  userId?: string;
  dateCreatedFilterRange: DateRange | undefined;
  setDateCreatedFilterRangeAction: React.Dispatch<React.SetStateAction<DateRange | undefined>>;
};

export function AppSidebar({
  userId,
  dateCreatedFilterRange,
  setDateCreatedFilterRangeAction,
  ...props
}: AppSidebarProps) {
  const [userDetails, setUserDetails] = React.useState<{
    Firstname: string;
    Lastname: string;
    Email: string;
    profilePicture: string;
    Position: string;
    Role: string;
  }>({
    Firstname: "",
    Lastname: "",
    Email: "",
    profilePicture: "",
    Position: "",
    Role: "",
  });

  const [jobPostingCount, setJobPostingCount] = React.useState(0);
  const [applicationCount, setApplicationCount] = React.useState(0);

  React.useEffect(() => {
    if (!userId) return;

    fetch(`/api/user?id=${encodeURIComponent(userId)}`)
      .then((res) => res.json())
      .then((data) =>
        setUserDetails({
          Firstname: data.Firstname || "",
          Lastname: data.Lastname || "",
          Email: data.Email || "",
          profilePicture: data.profilePicture || "",
          Position: data.Position || "",
          Role: data.Role || "",
        })
      )
      .catch(() => { /* silent */ });
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;

    const jobPostingQ = query(collection(db, "careers"));
    const unsubscribeJobPostings = onSnapshot(jobPostingQ, (snapshot) => {
      setJobPostingCount(snapshot.size);
    });

    const inquiriesQ = query(collection(db, "inquiries"), where("type", "==", "job"));
    const unsubscribeInquiries = onSnapshot(inquiriesQ, (snapshot) => {
      setApplicationCount(snapshot.size);
    });

    return () => {
      unsubscribeJobPostings();
      unsubscribeInquiries();
    };
  }, [userId]);

  const calendars = React.useMemo(() => {
    const baseCalendars = [];

    baseCalendars.push({
      name: "Time & Attendance",
      items: [
        {
          title: "Activity Calendar",
          href: `/activity-planner${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
          icon: CalendarCheck,
        },
        {
          title: "Location",
          href: `/time-attendance/location${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
          icon: MapPin,
        },
        {
          title: "Activity Logs",
          href: `/time-attendance/activity${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
          icon: FileText,
        },
        {
          title: "Timesheet",
          href: `/time-attendance/timesheet${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
          icon: Clock,
        },
      ],
    });

    const totalCount = jobPostingCount + applicationCount;
    baseCalendars.push({
      name: `Recruitment (${totalCount})`,
      items: [
        {
          title: `Job Posting (${jobPostingCount})`,
          href: `/recruitment/job-posting${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
          icon: Briefcase,
        },
        {
          title: `Applicant Inquiries (${applicationCount})`,
          href: `/recruitment/applicant-inquiries${userId ? `?id=${encodeURIComponent(userId)}` : ""}`,
          icon: Users,
        },
      ],
    });

    return baseCalendars;
  }, [userId, jobPostingCount, applicationCount]);

  function handleDateRangeSelect(range: DateRange | undefined) {
    setDateCreatedFilterRangeAction(range);
  }

  function handleRaiseTicketClick(userId?: string) {
    if (!userId) {
      return;
    }
    const url = `/ticket${userId ? `?id=${encodeURIComponent(userId)}` : ""}`;
    window.location.href = url;
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader className="border-sidebar-border h-16 border-b">
        {userId && (
          <NavUser
            user={{
              name: `${userDetails.Firstname} ${userDetails.Lastname}`.trim(),
              email: userDetails.Email,
              avatar: userDetails.profilePicture,
            }}
            userId={userId}
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          <DatePicker
            selectedDateRange={dateCreatedFilterRange}
            onDateSelectAction={handleDateRangeSelect}
          />
          <SidebarSeparator className="my-2" />

          <SidebarMenuItem>
            <Link
              href={`/dashboard${userId ? `?id=${encodeURIComponent(userId)}` : ""}`}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold hover:bg-muted transition"
            >
              <LayoutDashboard className="h-5 w-5 text-primary" />
              Dashboard
            </Link>
          </SidebarMenuItem>
        </SidebarMenu>

        <Calendars calendars={calendars} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center justify-center">
            <Button
              onClick={() => handleRaiseTicketClick(userId)}
              className="bg-black text-white py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-200"
            >
              <Plus size={18} /> Raise a Concern
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
