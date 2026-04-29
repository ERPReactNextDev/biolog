"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { format } from "date-fns";
import { toast } from "sonner";
import { Search, ArrowLeft, Loader2, ShieldCheck, User, X, History, Settings, UserPlus, Trash2, ShieldAlert } from "lucide-react";

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

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= TYPES ================= */

interface AuditLog {
    _id: string;
    adminId: string;
    adminName: string;
    action: string;
    targetId: string;
    targetName: string;
    details: string;
    date_created: string;
}

/* ================= PAGE ================= */

export default function AdminAuditLogsPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <AuditLogsContent />
            </FormatProvider>
        </UserProvider>
    );
}

function AuditLogsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

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

    /* ================= FETCH LOGS ================= */

    const fetchLogs = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/admin/audit-logs");
            if (!res.ok) throw new Error("Failed to fetch audit logs");
            const data = await res.json();
            setLogs(data || []);
        } catch (err) {
            toast.error("Failed to load audit logs");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!verifying) {
            fetchLogs();
        }
    }, [verifying, fetchLogs]);

    /* ================= FILTERED LOGS ================= */

    const filteredLogs = useMemo(() => {
        return logs.filter((log) => {
            const searchStr = searchQuery.toLowerCase();
            return (
                log.adminName.toLowerCase().includes(searchStr) ||
                log.targetName.toLowerCase().includes(searchStr) ||
                log.targetId.toLowerCase().includes(searchStr) ||
                log.action.toLowerCase().includes(searchStr) ||
                log.details.toLowerCase().includes(searchStr)
            );
        });
    }, [logs, searchQuery]);

    /* ================= HANDLERS ================= */

    const handleBack = () => {
        router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
    };

    const getActionIcon = (action: string) => {
        switch (action) {
            case "CREATE_USER": return <UserPlus size={16} className="text-green-600" />;
            case "DELETE_USER": return <Trash2 size={16} className="text-red-600" />;
            case "GRANT_ACCESS": return <ShieldCheck size={16} className="text-green-600" />;
            case "REVOKE_ACCESS": return <ShieldAlert size={16} className="text-orange-600" />;
            case "UPDATE_USER": return <User size={16} className="text-blue-600" />;
            case "UPDATE_SETTINGS": return <Settings size={16} className="text-purple-600" />;
            default: return <History size={16} className="text-gray-600" />;
        }
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
                                    Audit Trail
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
                                <h1 className="text-3xl font-bold tracking-tight text-gray-900">System Audit Trail</h1>
                                <p className="text-sm text-gray-500 mt-1">Monitor all administrative actions and changes for security and transparency.</p>
                            </div>
                        </div>

                        {/* Search */}
                        <Card className="rounded-[2rem] border-none shadow-sm overflow-hidden bg-white">
                            <div className="p-2 flex items-center">
                                <div className="pl-5 text-gray-400">
                                    <Search size={22} />
                                </div>
                                <Input 
                                    placeholder="Search by admin name, action, or target user..." 
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

                        {/* Audit Logs Table */}
                        <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white border border-gray-50">
                            <Table>
                                <TableHeader className="bg-gray-50/50">
                                    <TableRow className="border-gray-100 hover:bg-transparent">
                                        <TableHead className="w-[250px] font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 pl-10">Administrator</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Action</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Target User</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Timestamp</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-12 h-12 border-4 border-gray-100 border-t-brand-primary rounded-full animate-spin" />
                                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Loading history...</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredLogs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-20 h-20 rounded-[2.5rem] bg-gray-50 flex items-center justify-center text-gray-200">
                                                        <History size={40} />
                                                    </div>
                                                    <p className="text-lg font-bold text-gray-400">No actions recorded yet</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredLogs.map((log) => (
                                            <TableRow key={log._id} className="border-gray-50 hover:bg-gray-50/30 transition-all group">
                                                <TableCell className="pl-10 py-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-11 h-11 rounded-2xl bg-brand-light flex items-center justify-center text-brand-primary font-black uppercase text-base shadow-inner group-hover:bg-white group-hover:shadow-md transition-all">
                                                            {log.adminName[0]}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="font-bold text-gray-900 truncate">{log.adminName}</span>
                                                            <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Admin</span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                                                            {getActionIcon(log.action)}
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-black text-gray-800 uppercase tracking-widest">{log.action.replace("_", " ")}</span>
                                                            <span className="text-[11px] text-gray-400 font-medium leading-tight max-w-[200px]">{log.details}</span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-sm font-bold text-gray-700">{log.targetName}</span>
                                                        <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">ID: {log.targetId}</span>
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
