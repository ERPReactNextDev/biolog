"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/utils/supabase";
import { 
    Search, 
    ArrowLeft,
    Loader2,
    ShieldAlert,
    CheckCircle2,
    Clock,
    AlertCircle,
    MoreHorizontal,
    MessageSquare,
    Filter,
    X,
    User,
    Building2,
    Pencil
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= TYPES ================= */

interface TicketItem {
    id: string;
    ticket_id: string;
    requestor_name: string;
    ticket_subject: string;
    department: string;
    mode: string;
    status: string;
    remarks: string;
    date_created: string;
    priority?: string;
    referenceid: string;
}

/* ================= PAGE ================= */

export default function AdminTicketsPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <AdminTicketsContent />
            </FormatProvider>
        </UserProvider>
    );
}

function AdminTicketsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [tickets, setTickets] = useState<TicketItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("All");
    const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [editForm, setEditForm] = useState({
        status: "",
        remarks: "",
        priority: "Normal"
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

    /* ================= FETCH TICKETS ================= */

    const fetchTickets = useCallback(async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from("tickets")
                .select("*")
                .order("date_created", { ascending: false });

            if (error) throw error;
            setTickets(data || []);
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Failed to fetch tickets");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!verifying) {
            fetchTickets();
        }
    }, [verifying, fetchTickets]);

    /* ================= FILTERED TICKETS ================= */

    const filteredTickets = useMemo(() => {
        return tickets.filter(ticket => {
            const matchesSearch = 
                ticket.requestor_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                ticket.ticket_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                ticket.ticket_subject.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === "All" || ticket.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [tickets, searchQuery, statusFilter]);

    /* ================= HANDLERS ================= */

    const handleBack = () => {
        router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
    };

    const openEditDialog = (ticket: TicketItem) => {
        setSelectedTicket(ticket);
        setEditForm({
            status: ticket.status,
            remarks: ticket.remarks || "",
            priority: ticket.priority || "Normal"
        });
        setIsEditDialogOpen(true);
    };

    const handleUpdateTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket) return;

        try {
            setSubmitting(true);
            const { error } = await supabase
                .from("tickets")
                .update({
                    status: editForm.status,
                    remarks: editForm.remarks,
                    priority: editForm.priority,
                    ...(editForm.status === "Resolved" && { date_closed: new Date().toISOString() })
                })
                .eq("id", selectedTicket.id);

            if (error) throw error;

            toast.success("Ticket updated successfully");
            setIsEditDialogOpen(false);
            fetchTickets();
        } catch (err: any) {
            toast.error(err.message || "Failed to update ticket");
        } finally {
            setSubmitting(false);
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
                                    Manage Concerns
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
                                <h1 className="text-3xl font-bold tracking-tight text-gray-900">Employee Concerns</h1>
                                <p className="text-sm text-gray-500 mt-1">Review, prioritize, and resolve support tickets from your team.</p>
                            </div>
                        </div>

                        {/* Search and Filters */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Card className="md:col-span-3 rounded-[2rem] border-none shadow-sm overflow-hidden bg-white">
                                <div className="p-2 flex items-center">
                                    <div className="pl-5 text-gray-400">
                                        <Search size={22} />
                                    </div>
                                    <Input 
                                        placeholder="Search by ticket ID, requestor, or subject..." 
                                        className="border-none focus-visible:ring-0 text-base h-14 rounded-none bg-transparent"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </Card>

                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="h-18 rounded-[2rem] border-none bg-white shadow-sm font-bold text-gray-600 px-8">
                                    <div className="flex items-center gap-3">
                                        <Filter size={18} className="text-gray-400" />
                                        <SelectValue placeholder="Status" />
                                    </div>
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="All">All Status</SelectItem>
                                    <SelectItem value="Pending">Pending</SelectItem>
                                    <SelectItem value="Received">Received</SelectItem>
                                    <SelectItem value="In Progress">In Progress</SelectItem>
                                    <SelectItem value="Resolved">Resolved</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Tickets Table */}
                        <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white border border-gray-50">
                            <Table>
                                <TableHeader className="bg-gray-50/50">
                                    <TableRow className="border-gray-100 hover:bg-transparent">
                                        <TableHead className="w-[280px] font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 pl-10">Ticket & Requestor</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Subject</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Priority</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Status</TableHead>
                                        <TableHead className="w-[100px] text-right pr-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-12 h-12 border-4 border-gray-100 border-t-brand-primary rounded-full animate-spin" />
                                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Loading tickets...</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredTickets.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-20 h-20 rounded-[2.5rem] bg-gray-50 flex items-center justify-center text-gray-200">
                                                        <MessageSquare size={40} />
                                                    </div>
                                                    <p className="text-lg font-bold text-gray-400">No concerns found</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredTickets.map((ticket) => (
                                            <TableRow key={ticket.id} className="border-gray-50 hover:bg-gray-50/30 transition-all group">
                                                <TableCell className="pl-10 py-6">
                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-[10px] font-black text-brand-primary uppercase tracking-widest">{ticket.ticket_id}</span>
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-xs uppercase">
                                                                {ticket.requestor_name[0]}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-sm font-bold text-gray-900 truncate">{ticket.requestor_name}</span>
                                                                <span className="text-[10px] text-gray-400 font-medium truncate">{ticket.department}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-sm font-bold text-gray-700 line-clamp-1">{ticket.ticket_subject}</span>
                                                        <span className="text-[10px] text-gray-400 font-medium">
                                                            Created {format(new Date(ticket.date_created), "MMM dd, hh:mm aa")}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={`rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                                                        ticket.priority === "Urgent" 
                                                        ? "bg-red-50 text-red-600 border-red-100" 
                                                        : ticket.priority === "High"
                                                        ? "bg-orange-50 text-orange-600 border-orange-100"
                                                        : "bg-blue-50 text-blue-600 border-blue-100"
                                                    }`} variant="outline">
                                                        {ticket.priority || "Normal"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={`rounded-full px-4 py-1 text-[10px] font-black uppercase tracking-widest ${
                                                        ticket.status === "Resolved" 
                                                        ? "bg-green-50 text-green-600 border-green-100" 
                                                        : ticket.status === "In Progress"
                                                        ? "bg-blue-50 text-blue-600 border-blue-100"
                                                        : "bg-orange-50 text-orange-600 border-orange-100"
                                                    }`} variant="outline">
                                                        {ticket.status === "Resolved" ? <CheckCircle2 size={10} className="mr-1.5" /> : ticket.status === "In Progress" ? <Clock size={10} className="mr-1.5" /> : <AlertCircle size={10} className="mr-1.5" />}
                                                        {ticket.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="pr-10 text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" className="h-10 w-10 p-0 rounded-xl group-hover:bg-white group-hover:shadow-md transition-all">
                                                                <MoreHorizontal className="h-5 w-5 text-gray-400" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="rounded-[1.5rem] w-[200px] p-2 shadow-2xl border-none">
                                                            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-black px-4 py-3">Quick Actions</DropdownMenuLabel>
                                                            <DropdownMenuItem onClick={() => openEditDialog(ticket)} className="gap-3 px-4 py-3 cursor-pointer rounded-xl font-bold text-sm focus:bg-brand-light focus:text-brand-primary transition-colors">
                                                                <Pencil size={16} />
                                                                Update Status
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </div>
                </main>

                {/* Edit Dialog */}
                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogContent className="sm:max-w-[500px] rounded-[2.5rem] border-none shadow-2xl p-0 overflow-hidden">
                        <form onSubmit={handleUpdateTicket}>
                            <div className="p-8 pb-4">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-bold text-gray-900">Update Ticket</DialogTitle>
                                    <DialogDescription className="text-gray-500">
                                        Update the status and priority for ticket {selectedTicket?.ticket_id}.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-6 py-8">
                                    <div className="grid gap-2.5">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Status</Label>
                                        <Select value={editForm.status} onValueChange={(v) => setEditForm(prev => ({ ...prev, status: v }))}>
                                            <SelectTrigger className="rounded-2xl border-gray-100 h-12 bg-gray-50/50 focus:bg-white transition-all px-4 font-bold">
                                                <SelectValue placeholder="Select status" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-2xl">
                                                <SelectItem value="Pending">Pending</SelectItem>
                                                <SelectItem value="Received">Received</SelectItem>
                                                <SelectItem value="In Progress">In Progress</SelectItem>
                                                <SelectItem value="Resolved">Resolved</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2.5">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Priority</Label>
                                        <Select value={editForm.priority} onValueChange={(v) => setEditForm(prev => ({ ...prev, priority: v }))}>
                                            <SelectTrigger className="rounded-2xl border-gray-100 h-12 bg-gray-50/50 focus:bg-white transition-all px-4 font-bold">
                                                <SelectValue placeholder="Select priority" />
                                            </SelectTrigger>
                                            <SelectContent className="rounded-2xl">
                                                <SelectItem value="Normal">Normal</SelectItem>
                                                <SelectItem value="High">High</SelectItem>
                                                <SelectItem value="Urgent">Urgent</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2.5">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Admin Remarks</Label>
                                        <Textarea 
                                            value={editForm.remarks} 
                                            onChange={(e) => setEditForm(prev => ({ ...prev, remarks: e.target.value }))}
                                            placeholder="Add notes or update details..."
                                            className="rounded-2xl border-gray-100 min-h-[120px] bg-gray-50/50 focus:bg-white transition-all p-4"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="bg-gray-50 px-8 py-6 flex justify-end gap-3 border-t">
                                <Button type="button" variant="ghost" onClick={() => setIsEditDialogOpen(false)} className="rounded-xl h-11 px-6 font-semibold">Cancel</Button>
                                <Button type="submit" disabled={submitting} className="bg-brand-primary hover:bg-brand-primary-hover text-white rounded-xl h-11 px-8 font-bold min-w-[140px] shadow-lg shadow-brand-primary/20">
                                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save Changes"}
                                </Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>
        </ProtectedPageWrapper>
    );
}
