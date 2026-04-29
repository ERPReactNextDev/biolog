"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";
import { TrendingUp } from "lucide-react";

import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import type { DateRange } from "react-day-picker";

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

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";


import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= TYPES ================= */

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

interface UserItem {
    _id: string;
    Firstname: string;
    Lastname: string;
    Email: string;
    Role: string;
    Department: string;
    Status: string;
    Company?: string;
}

/* ================= CHART CONFIG ================= */

const chartConfig = {
    count: {
        label: "Count",
        color: "var(--chart-2)",
    },
    label: {
        color: "var(--background)",
    },
} satisfies ChartConfig;

/* ================= PAGE ================= */

export default function Page() {
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
    const [users, setUsers] = useState<UserItem[]>([]);

    const [loadingUser, setLoadingUser] = useState(true);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dateCreatedFilterRange, setDateCreatedFilterRange] =
        useState<DateRange | undefined>(undefined);

    /* ================= DATE RANGE ================= */

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

    /* ================= USER ID ================= */

    const queryUserId = searchParams?.get("id") ?? "";

    useEffect(() => {
        if (queryUserId && queryUserId !== userId) {
            setUserId(queryUserId);
        }
    }, [queryUserId, userId, setUserId]);

    /* ================= CURRENT USER ================= */

    useEffect(() => {
        if (!queryUserId) return;

        const fetchUser = async () => {
            try {
                setLoadingUser(true);
                const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
                if (!res.ok) throw new Error("Failed to fetch user");

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
            } finally {
                setLoadingUser(false);
            }
        };

        fetchUser();
    }, [queryUserId]);

    /* ================= ALL USERS ================= */

    useEffect(() => {
        if (!queryUserId) return;

        const fetchUsers = async () => {
            try {
                setLoadingUsers(true);
                const res = await fetch(`/api/getUsers?id=${encodeURIComponent(queryUserId)}`);
                if (!res.ok) throw new Error("Failed to fetch users");

                const data = await res.json();
                setUsers(Array.isArray(data) ? data : []);
            } catch (err) {
                setUsers([]);
            } finally {
                setLoadingUsers(false);
            }
        };

        fetchUsers();
    }, [queryUserId]);

    /* ================= DASHBOARD COUNTS ================= */

    const totalUsers = users.length;

    const activeUsers = useMemo(
        () => users.filter((u) => u.Status?.toLowerCase() === "active").length,
        [users]
    );

    const resignUsers = useMemo(
        () => users.filter((u) => u.Status?.toLowerCase() === "resigned").length,
        [users]
    );

    const terminatedUsers = useMemo(
        () => users.filter((u) => u.Status?.toLowerCase() === "terminated").length,
        [users]
    );

    /* =============== BAR CHART DATA =============== */

    const countByKey = (key: keyof UserItem) => {
        const counts: Record<string, number> = {};
        users.forEach((user) => {
            const val = user[key] ?? "Unknown";
            counts[val] = (counts[val] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([name, count]) => ({ month: name, desktop: count })) // reuse "month" & "desktop" keys for chart compatibility
            .sort((a, b) => b.desktop - a.desktop);
    };

    const companyData = useMemo(() => countByKey("Company"), [users]);
    const departmentData = useMemo(() => countByKey("Department"), [users]);

    /* ================= RENDER ================= */

    return (
        <UserProvider>
            <FormatProvider>
                <SidebarProvider>
                    <AppSidebar
                        userId={userId ?? undefined}
                        dateCreatedFilterRange={dateCreatedFilterRange}
                        setDateCreatedFilterRangeAction={setDateCreatedFilterRange}
                    />

                    <SidebarInset>
                        <header className="sticky top-0 z-10 flex h-16 items-center gap-2 border-b bg-background px-4">
                            <SidebarTrigger className="-ml-1" />
                            <Separator orientation="vertical" className="h-4" />
                            <Breadcrumb>
                                <BreadcrumbList>
                                    <BreadcrumbItem>
                                        <BreadcrumbPage>Dashboard</BreadcrumbPage>
                                    </BreadcrumbItem>
                                </BreadcrumbList>
                            </Breadcrumb>
                        </header>

                        <main className="flex flex-1 flex-col gap-6 p-4">
                            {/* ===== DASHBOARD CARDS ===== */}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <DashboardCard
                                    title="Total Registered Users"
                                    description="IN ERP System"
                                    value={loadingUsers ? "—" : totalUsers}
                                />
                                <DashboardCard
                                    title="Active Users"
                                    description="Currently active users"
                                    value={loadingUsers ? "—" : activeUsers}
                                    accent="text-green-600"
                                />
                                <DashboardCard
                                    title="Resign Users"
                                    description="Users who resigned"
                                    value={loadingUsers ? "—" : resignUsers}
                                />
                                <DashboardCard
                                    title="Terminated Users"
                                    description="Users who were terminated"
                                    value={loadingUsers ? "—" : terminatedUsers}
                                    accent="text-blue-600"
                                />
                            </div>

                            {/* ===== BAR CHARTS ===== */}
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                <ChartBarLabelCustom
                                    title="Users Count Per Company"
                                    description="Grouped by Company"
                                    data={companyData}
                                    color="var(--color-desktop)"
                                />
                                <ChartBarLabelCustom
                                    title="Users Count Per Department"
                                    description="Grouped by Department"
                                    data={departmentData}
                                    color="var(--color-accent)"
                                />
                            </div>
                        </main>
                    </SidebarInset>
                </SidebarProvider>
            </FormatProvider>
        </UserProvider>
    );
}

/* ================= CARD COMPONENT ================= */

function DashboardCard({
    title,
    description,
    value,
    accent = "",
}: {
    title: string;
    description?: string;
    value: number | string;
    accent?: string;
}) {
    return (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-lg text-muted-foreground uppercase font-bold">{title}</p>
            {description && (
                <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
            <p className={`mt-2 text-3xl font-bold ${accent}`}>{value}</p>
        </div>
    );
}

/* ================= CHART COMPONENT ================= */

function ChartBarLabelCustom({
    title,
    description,
    data,
    color,
}: {
    title: string;
    description?: string;
    data: { month: string; desktop: number }[];
    color: string;
}) {
    return (
        <ProtectedPageWrapper>
            <Card>
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                    {description && <CardDescription>{description}</CardDescription>}
                </CardHeader>
                <CardContent>
                    <ChartContainer config={chartConfig}>
                        <BarChart
                            accessibilityLayer
                            data={data}
                            layout="vertical"
                            margin={{
                                right: 100,
                            }}
                        >
                            <CartesianGrid horizontal={false} />
                            <YAxis
                                dataKey="month"
                                type="category"
                                tickLine={false}
                                tickMargin={10}
                                axisLine={false}
                                tickFormatter={(value) => (value.length > 10 ? value.slice(0, 10) + "..." : value)}
                                width={150}
                            />
                            <XAxis dataKey="desktop" type="number" hide />
                            <ChartTooltip
                                cursor={false}
                                content={<ChartTooltipContent indicator="line" />}
                            />
                            <Bar
                                dataKey="desktop"
                                layout="vertical"
                                fill={color}
                                radius={4}
                            >
                                <LabelList
                                    dataKey="desktop"
                                    position="right"
                                    offset={8}
                                    className="fill-foreground"
                                    fontSize={12}
                                />

                            </Bar>
                        </BarChart>
                    </ChartContainer>
                </CardContent>
                <CardFooter className="flex-col items-start gap-2 text-sm">
                    <div className="flex gap-2 leading-none font-medium">
                        Trending up by 5.2% this month <TrendingUp className="h-4 w-4" />
                    </div>
                    <div className="text-muted-foreground leading-none">
                        Showing total count
                    </div>
                </CardFooter>
            </Card>
        </ProtectedPageWrapper>
    );
}
