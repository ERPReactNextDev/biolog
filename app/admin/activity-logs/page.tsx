"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { type DateRange } from "react-day-picker";
import { format } from "date-fns";
import { toast } from "sonner";
import { 
    Search, 
    Calendar as CalendarIcon,
    ArrowLeft,
    Loader2,
    MapPin,
    Building2,
    Info,
    LogIn,
    LogOut,
    Filter,
    X,
    FileSpreadsheet,
    RefreshCcw
} from "lucide-react";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= TYPES ================= */

interface ActivityLog {
    _id: string;
    ReferenceID: string;
    Email: string;
    Type: string;
    Status: string;
    Location: string;
    date_created: string;
    PhotoURL?: string;
    Remarks: string;
    SiteVisitAccount: string;
}

interface UserInfo {
    Firstname: string;
    Lastname: string;
    profilePicture?: string;
}

/* ================= PAGE ================= */

export default function AdminActivityLogsPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <ActivityLogsContent />
            </FormatProvider>
        </UserProvider>
    );
}

function ActivityLogsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [usersMap, setUsersMap] = useState<Record<string, UserInfo>>({});
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    const queryUserId = searchParams?.get("id") ?? "";

    useEffect(() => {
        if (queryUserId && queryUserId !== userId) {
            setUserId(queryUserId);
        }
    }, [queryUserId, userId, setUserId]);

    /* ================= VERIFY ADMIN ACCESS ================= */

    useEffect(() => {
        if (!queryUserId) return;

        const verifyAdmin = async () => {
            try {
                setVerifying(true);
                const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
                if (!res.ok) {
                    router.push("/Login");
                    return;
                }
                const data = await res.json();
                if (data.Role !== "Admin" && data.Role !== "Super Admin" && data.Department !== "IT") {
                    toast.error("Unauthorized access");
                    router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
                    return;
                }
                setVerifying(false);
            } catch (err) {
                console.error(err);
                router.push("/Login");
            }
        };

        verifyAdmin();
    }, [queryUserId, router]);

    /* ================= FETCH LOGS ================= */

    const fetchLogs = useCallback(async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.append("page", "1");
            params.append("limit", "500");
            params.append("role", "Super Admin"); // To get all logs

            if (dateRange?.from) {
                params.append("startDate", dateRange.from.toISOString());
                if (dateRange.to) {
                    params.append("endDate", dateRange.to.toISOString());
                }
            }

            const res = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
            if (!res.ok) throw new Error("Failed to fetch logs");
            const data = await res.json();
            setLogs(data.data || []);

            // Fetch users for mapping
            const uniqueRefs = Array.from(new Set((data.data || []).map((l: any) => l.ReferenceID)));
            if (uniqueRefs.length > 0) {
                const usersRes = await fetch(`/api/users?referenceIDs=${uniqueRefs.join(",")}`);
                if (usersRes.ok) {
                    const usersData = await usersRes.json();
                    const map: Record<string, UserInfo> = {};
                    usersData.forEach((u: any) => {
                        map[u.ReferenceID] = {
                            Firstname: u.Firstname,
                            Lastname: u.Lastname,
                            profilePicture: u.profilePicture
                        };
                    });
                    setUsersMap(map);
                }
            }
        } catch (err) {
            console.error(err);
            toast.error("Failed to load activity logs");
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        if (!verifying) {
            fetchLogs();
        }
    }, [verifying, fetchLogs]);

    /* ================= FILTERED LOGS ================= */

    const filteredLogs = useMemo(() => {
        return logs.filter((log) => {
            const searchStr = searchQuery.toLowerCase();
            const userInfo = usersMap[log.ReferenceID];
            const userName = userInfo ? `${userInfo.Firstname} ${userInfo.Lastname}`.toLowerCase() : "";
            
            return (
                userName.includes(searchStr) ||
                (log.Email || "").toLowerCase().includes(searchStr) ||
                (log.ReferenceID || "").toLowerCase().includes(searchStr) ||
                (log.Type || "").toLowerCase().includes(searchStr) ||
                (log.Status || "").toLowerCase().includes(searchStr) ||
                (log.SiteVisitAccount && log.SiteVisitAccount.toLowerCase().includes(searchStr))
            );
        });
    }, [logs, searchQuery, usersMap]);

    /* ================= HANDLERS ================= */

    const handleBack = () => {
        router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
    };

    /* ================= RENDER ================= */

    if (verifying) {
        return (
            <div className="flex h-screen items-center justify-center bg-brand-bg">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-brand-primary" />
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Verifying access...</p>
                </div>
            </div>
        );
    }

    return (
        <ProtectedPageWrapper>
            <div className="flex min-h-screen flex-col bg-brand-bg">
                {/* Header */}
                <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-white px-4 md:px-6 shadow-sm">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={handleBack}
                        className="h-9 w-9 rounded-xl border border-gray-100 text-gray-500 hover:bg-gray-50 hover:text-brand-primary transition-all"
                    >
                        <ArrowLeft size={18} />
                    </Button>
                    <Separator orientation="vertical" className="h-4" />
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbPage className="text-gray-400 font-medium">Admin</BreadcrumbPage>
                            </BreadcrumbItem>
                            <Separator orientation="vertical" className="mx-2 h-4" />
                            <BreadcrumbItem>
                                <BreadcrumbPage className="font-bold text-brand-primary">
                                    Activity Logs
                                </BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                </header>

                <main className="flex-1 overflow-auto p-4 md:p-8 lg:p-12">
                    <div className="mx-auto max-w-7xl flex flex-col gap-8">
                        {/* Header Actions */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <h1 className="text-3xl font-bold tracking-tight text-gray-900">Activity Logs</h1>
                                <p className="text-sm text-gray-500 mt-1">Monitor all system activities and field attendance.</p>
                            </div>
                            
                            <div className="flex items-center gap-3">
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    onClick={fetchLogs}
                                    disabled={loading}
                                    className="h-12 w-12 rounded-2xl border-gray-100 bg-white text-gray-400 hover:text-brand-primary transition-all"
                                >
                                    <RefreshCcw size={20} className={loading ? "animate-spin" : ""} />
                                </Button>

                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className={`h-12 px-6 rounded-2xl border-gray-100 bg-white font-bold gap-3 transition-all ${dateRange ? "text-brand-primary border-brand-primary/20 bg-brand-light" : "text-gray-600"}`}>
                                            <CalendarIcon size={18} />
                                            {dateRange?.from ? (
                                                dateRange.to ? (
                                                    <span className="text-xs">{format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d")}</span>
                                                ) : (
                                                    <span className="text-xs">{format(dateRange.from, "MMM d, yyyy")}</span>
                                                )
                                            ) : (
                                                <span className="text-xs">Filter by Date</span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0 rounded-[2rem] border-none shadow-2xl" align="end">
                                        <Calendar
                                            initialFocus
                                            mode="range"
                                            defaultMonth={dateRange?.from}
                                            selected={dateRange}
                                            onSelect={setDateRange}
                                            numberOfMonths={1}
                                            className="p-4"
                                        />
                                        {dateRange && (
                                            <div className="p-4 border-t bg-gray-50 flex justify-end">
                                                <Button variant="ghost" size="sm" onClick={() => setDateRange(undefined)} className="text-xs font-bold text-gray-400 hover:text-red-600 rounded-xl">
                                                    Clear Filter
                                                </Button>
                                            </div>
                                        )}
                                    </PopoverContent>
                                </Popover>

                                <Button variant="outline" className="h-12 w-12 rounded-2xl border-gray-100 bg-white p-0 text-gray-400 hover:text-brand-primary transition-all">
                                    <FileSpreadsheet size={20} />
                                </Button>
                            </div>
                        </div>

                        {/* Search */}
                        <Card className="rounded-[2rem] border-none shadow-sm overflow-hidden bg-white">
                            <div className="p-2 flex items-center">
                                <div className="pl-5 text-gray-400">
                                    <Search size={22} />
                                </div>
                                <Input 
                                    placeholder="Search by name, status, ID, or account..." 
                                    className="border-none focus-visible:ring-0 text-base h-14 rounded-none bg-transparent"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                                {searchQuery && (
                                    <Button variant="ghost" size="icon" onClick={() => setSearchQuery("")} className="mr-2 text-gray-300 hover:text-gray-500 rounded-xl">
                                        <X size={18} />
                                    </Button>
                                )}
                            </div>
                        </Card>

                        {/* Logs Table */}
                        <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white border border-gray-50">
                            <Table>
                                <TableHeader className="bg-gray-50/50">
                                    <TableRow className="border-gray-100 hover:bg-transparent">
                                        <TableHead className="w-[280px] font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 pl-10">Employee</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Activity</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Location / Account</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Time & Date</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-12 h-12 border-4 border-gray-100 border-t-brand-primary rounded-full animate-spin" />
                                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Loading activities...</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredLogs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-20 h-20 rounded-[2.5rem] bg-gray-50 flex items-center justify-center text-gray-200">
                                                        <Filter size={40} />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <p className="text-lg font-bold text-gray-400">No logs found</p>
                                                        <p className="text-xs text-gray-400 px-12">Adjust your filters or search query to find records.</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredLogs.map((log) => {
                                            const user = usersMap[log.ReferenceID];
                                            const isLogin = log.Status === "Login";
                                            const isVisit = log.Type === "Client Visit";
                                            
                                            return (
                                                <TableRow key={log._id} className="border-gray-50 hover:bg-gray-50/30 transition-all group">
                                                    <TableCell className="pl-10 py-6">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-500 font-black uppercase text-base shadow-inner group-hover:bg-white group-hover:shadow-md transition-all">
                                                                {user ? `${user.Firstname[0]}${user.Lastname[0]}` : "?"}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="font-bold text-gray-900 truncate">{user ? `${user.Firstname} ${user.Lastname}` : log.Email}</span>
                                                                <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider">ID: {log.ReferenceID}</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isLogin ? "bg-green-50 text-green-600" : isVisit ? "bg-orange-50 text-orange-600" : "bg-brand-light text-brand-primary"}`}>
                                                                {isLogin ? <LogIn size={16} /> : isVisit ? <Building2 size={16} /> : <LogOut size={16} />}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-bold text-gray-800">{log.Status}</span>
                                                                <span className="text-[10px] text-gray-400 font-medium">{log.Type}</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1.5 max-w-[300px]">
                                                            <div className="flex items-start gap-2">
                                                                <MapPin size={12} className="text-gray-300 mt-0.5 flex-shrink-0" />
                                                                <span className="text-[11px] text-gray-500 font-medium line-clamp-2 leading-tight">{log.Location || "No location captured"}</span>
                                                            </div>
                                                            {isVisit && log.SiteVisitAccount && (
                                                                <div className="flex items-center gap-2">
                                                                    <Building2 size={12} className="text-orange-300 flex-shrink-0" />
                                                                    <span className="text-[10px] font-bold text-orange-600 uppercase tracking-tighter truncate">{log.SiteVisitAccount}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-sm font-black text-gray-700 tabular-nums">
                                                                {format(new Date(log.date_created), "hh:mm aa")}
                                                            </span>
                                                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                                                {format(new Date(log.date_created), "MMM dd, yyyy")}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </div>
                </main>
            </div>
        </ProtectedPageWrapper>
    );
}
