"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { Search, Calendar as CalendarIcon, ArrowLeft, Loader2, Download, Filter, Users, Building2, RefreshCcw } from "lucide-react";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= TYPES ================= */

interface UserItem {
    _id: string;
    Firstname: string;
    Lastname: string;
    Email: string;
    Department: string;
    ReferenceID: string;
    Company?: string;
}

interface ActivityLog {
    ReferenceID: string;
    Status: string;
    date_created: string;
}

interface AttendanceSummary {
    id: string;
    ReferenceID: string;
    Name: string;
    Email: string;
    Department: string;
    TotalLogins: number;
    TotalLogouts: number;
    Logs: ActivityLog[];
}

/* ================= PAGE ================= */

export default function AttendanceSummaryPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <AttendanceSummaryContent />
            </FormatProvider>
        </UserProvider>
    );
}

function AttendanceSummaryContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [users, setUsers] = useState<UserItem[]>([]);
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDepartment, setSelectedDepartment] = useState<string>("All");
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        to: new Date()
    });

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
                if (data.Role !== "Admin" && data.Role !== "SuperAdmin" && data.Department !== "IT") {
                    toast.error("Unauthorized access");
                    router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
                    return;
                }
                setVerifying(false);
            } catch (err) {
                router.push("/Login");
            }
        };

        verifyAdmin();
    }, [queryUserId, router]);

    /* ================= FETCH DATA ================= */

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            
            // 1. Fetch Users
            const usersRes = await fetch("/api/admin/users");
            const usersData = await usersRes.json();
            setUsers(Array.isArray(usersData) ? usersData : []);

            // 2. Fetch Logs
            const params = new URLSearchParams();
            params.append("page", "1");
            params.append("limit", "1000");
            params.append("role", "SuperAdmin");
            if (dateRange?.from) params.append("startDate", dateRange.from.toISOString());
            if (dateRange?.to) params.append("endDate", dateRange.to.toISOString());

            const logsRes = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
            const logsData = await logsRes.json();
            setLogs(logsData.data || []);

        } catch (err) {
            toast.error("Failed to load attendance data");
        } finally {
            setLoading(false);
        }
    }, [dateRange]);

    useEffect(() => {
        if (!verifying) {
            fetchData();
        }
    }, [verifying, fetchData]);

    /* ================= SUMMARY DATA ================= */

    const departments = useMemo(() => {
        const deps = new Set(users.map(u => u.Department));
        return ["All", ...Array.from(deps)].sort();
    }, [users]);

    const summaryData = useMemo(() => {
        const data: AttendanceSummary[] = users.map(user => {
            const userLogs = logs.filter(l => l.ReferenceID === user.ReferenceID);
            return {
                id: user._id,
                ReferenceID: user.ReferenceID,
                Name: `${user.Firstname} ${user.Lastname}`,
                Email: user.Email,
                Department: user.Department,
                TotalLogins: userLogs.filter(l => l.Status === "Login").length,
                TotalLogouts: userLogs.filter(l => l.Status === "Logout").length,
                Logs: userLogs
            };
        });

        return data.filter(item => {
            const matchesSearch = (item.Name || "").toLowerCase().includes(searchQuery.toLowerCase()) || 
                                 (item.ReferenceID || "").toLowerCase().includes(searchQuery.toLowerCase());
            const matchesDept = selectedDepartment === "All" || item.Department === selectedDepartment;
            return matchesSearch && matchesDept;
        });
    }, [users, logs, searchQuery, selectedDepartment]);

    /* ================= EXPORT TO EXCEL ================= */

    const handleExport = async () => {
        if (summaryData.length === 0) {
            toast.error("No data to export");
            return;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Attendance Summary");

        // Set columns
        worksheet.columns = [
            { header: "Reference ID", key: "ref", width: 15 },
            { header: "Full Name", key: "name", width: 25 },
            { header: "Department", key: "dept", width: 20 },
            { header: "Email", key: "email", width: 30 },
            { header: "Total Logins", key: "logins", width: 15 },
            { header: "Total Logouts", key: "logouts", width: 15 },
        ];

        // Add rows
        summaryData.forEach(item => {
            worksheet.addRow({
                ref: item.ReferenceID,
                name: item.Name,
                dept: item.Department,
                email: item.Email,
                logins: item.TotalLogins,
                logouts: item.TotalLogouts,
            });
        });

        // Styling
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFCC1318" }
        };
        worksheet.getRow(1).font = { color: { argb: "FFFFFFFF" }, bold: true };

        // Generate Buffer
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        saveAs(blob, `Attendance_Summary_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
        toast.success("Excel file generated successfully");
    };

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
                                    Attendance Summary
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
                                <h1 className="text-3xl font-bold tracking-tight text-gray-900">Attendance Summary</h1>
                                <p className="text-sm text-gray-500 mt-1">Generate payroll-ready reports and monitor total work logs.</p>
                            </div>
                            
                            <div className="flex items-center gap-3">
                                <Button 
                                    variant="outline" 
                                    size="icon" 
                                    onClick={fetchData}
                                    disabled={loading}
                                    className="h-12 w-12 rounded-2xl border-gray-100 bg-white text-gray-400 hover:text-brand-primary transition-all"
                                >
                                    <RefreshCcw size={20} className={loading ? "animate-spin" : ""} />
                                </Button>
                                <Button 
                                    onClick={handleExport}
                                    disabled={loading || summaryData.length === 0}
                                    className="bg-[#1A7A4A] hover:bg-[#145A32] text-white gap-2 rounded-2xl h-12 px-8 shadow-lg shadow-green-100 transition-all active:scale-95 font-bold"
                                >
                                    <Download size={20} />
                                    Export to Excel
                                </Button>
                            </div>
                        </div>

                        {/* Filters */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                            <Card className="md:col-span-5 rounded-2xl border-none shadow-sm overflow-hidden bg-white">
                                <div className="p-2 flex items-center">
                                    <div className="pl-4 text-gray-400">
                                        <Search size={20} />
                                    </div>
                                    <Input 
                                        placeholder="Search employee name or ID..." 
                                        className="border-none focus-visible:ring-0 text-sm h-10 rounded-none bg-transparent"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </Card>

                            <div className="md:col-span-3">
                                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                                    <SelectTrigger className="h-14 rounded-2xl border-none bg-white shadow-sm font-bold text-gray-600 px-6">
                                        <div className="flex items-center gap-3">
                                            <Building2 size={18} className="text-gray-400" />
                                            <SelectValue placeholder="Department" />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="rounded-2xl">
                                        {departments.map(dept => (
                                            <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="md:col-span-4">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="h-14 w-full px-6 rounded-2xl border-none bg-white shadow-sm font-bold text-gray-600 gap-3 justify-start overflow-hidden">
                                            <CalendarIcon size={18} className="text-gray-400" />
                                            {dateRange?.from ? (
                                                dateRange.to ? (
                                                    <span className="text-xs">{format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d")}</span>
                                                ) : (
                                                    <span className="text-xs">{format(dateRange.from, "MMM d, yyyy")}</span>
                                                )
                                            ) : (
                                                <span className="text-xs">Select Date Range</span>
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
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>

                        {/* Summary Table */}
                        <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
                            <Table>
                                <TableHeader className="bg-gray-50/50">
                                    <TableRow className="border-gray-100 hover:bg-transparent">
                                        <TableHead className="w-[300px] font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 pl-10">Employee</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Department</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 text-center">Logins</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 text-center">Logouts</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 text-right pr-10">Reference ID</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-12 h-12 border-4 border-gray-100 border-t-brand-primary rounded-full animate-spin" />
                                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Compiling summary...</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : summaryData.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-20 h-20 rounded-[2.5rem] bg-gray-50 flex items-center justify-center text-gray-200">
                                                        <Filter size={40} />
                                                    </div>
                                                    <p className="text-lg font-bold text-gray-400">No matching records</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        summaryData.map((item) => (
                                            <TableRow key={item.id} className="border-gray-50 hover:bg-gray-50/30 transition-all group">
                                                <TableCell className="pl-10 py-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-500 font-black uppercase shadow-inner group-hover:bg-white group-hover:shadow-md transition-all">
                                                            {item.Name[0]}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="font-bold text-gray-900 group-hover:text-brand-primary transition-colors truncate">{item.Name}</span>
                                                            <span className="text-[11px] text-gray-400 font-medium truncate">{item.Email}</span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                                                        <Building2 size={14} className="text-gray-300" />
                                                        {item.Department}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl font-bold text-sm ${item.TotalLogins > 0 ? "bg-green-50 text-green-600" : "bg-gray-50 text-gray-300"}`}>
                                                        {item.TotalLogins}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl font-bold text-sm ${item.TotalLogouts > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-50 text-gray-300"}`}>
                                                        {item.TotalLogouts}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right pr-10">
                                                    <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{item.ReferenceID}</span>
                                                </TableCell>
                                            </TableRow>
                                        ))
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
