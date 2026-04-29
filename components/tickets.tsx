"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell, } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious, } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

import { ReceivedDialog } from "@/components/tickets-dialog";
import { supabase as _supabase } from "@/utils/supabase"
const supabase = _supabase!;

interface RequestItem {
    id: string; // Supabase uses `id` not `_id`
    ticket_id: string;
    requestor_name: string;
    ticket_subject: string;
    department: string;
    mode: string;
    status: string;
    remarks: string;
    date_created?: string;
}

interface RequestProps {
    referenceid: string;
    department: string;
    fullname: string;
}

const PAGE_SIZE = 10;

export const Received: React.FC<RequestProps> = ({
    referenceid,
    department,
    fullname,
}) => {
    const [activities, setActivities] = useState<RequestItem[]>([]);
    const [loadingActivities, setLoadingActivities] = useState(false);
    const [errorActivities, setErrorActivities] = useState<string | null>(null);

    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");

    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [filterOpen, setFilterOpen] = useState(false);

    const [statusFilter, setStatusFilter] = useState<string>("");
    const [requestTypeFilter, setRequestTypeFilter] = useState<string>("");
    const [priorityFilter, setPriorityFilter] = useState<string>("");

    const [, forceTick] = useState(0);
    useEffect(() => {
        const interval = setInterval(() => {
            forceTick((t) => t + 1);
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const [form, setForm] = useState<Omit<RequestItem, "id">>({
        ticket_id: "",
        requestor_name: "",
        ticket_subject: "",
        department: "",
        mode: "",
        status: "",
        remarks: "",
        date_created: "",
    });

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const existingTicketIds = activities.map(item => item.ticket_id);
    
    function handleSelectChange(name: string, value: string) {
        setForm((prev) => ({
            ...prev,
            [name]: value,
        }));
    }

    const fetchActivities = useCallback(async () => {
        if (!referenceid) {
            setActivities([]);
            return;
        }
        setLoadingActivities(true);
        setErrorActivities(null);

        try {
            if (!supabase) throw new Error("Supabase not initialized");
            const { data, error } = await supabase
                .from("tickets")
                .select("*")
                .eq("referenceid", referenceid)
                .order("date_created", { ascending: false });

            if (error) throw error;

            setActivities(data ?? []);
        } catch (error: any) {
            setErrorActivities(error.message || "Error fetching tickets");
            toast.error(error.message || "Error fetching tickets");
        } finally {
            setLoadingActivities(false);
        }
    }, [referenceid]);

    useEffect(() => {
        fetchActivities();
    }, [referenceid, fetchActivities]);

    useEffect(() => {
        if (!referenceid) return;

        if (!supabase) return;
        const channel = supabase
            .channel(`public:tickets:referenceid=eq.${referenceid}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "tickets",
                },
                (payload) => {
                    const newRecord = payload.new as RequestItem;
                    const oldRecord = payload.old as RequestItem;

                    setActivities((curr) => {
                        switch (payload.eventType) {
                            case "INSERT":
                                if (!curr.some((a) => a.id === newRecord.id)) {
                                    return [...curr, newRecord];
                                }
                                return curr;
                            case "UPDATE":
                                return curr.map((a) => (a.id === newRecord.id ? newRecord : a));
                            case "DELETE":
                                return curr.filter((a) => a.id !== oldRecord.id);
                            default:
                                return curr;
                        }
                    });
                }
            )
            .subscribe();

        return () => {
            if (supabase) supabase.removeChannel(channel);
        };
    }, [referenceid]);

    const filteredActivities = useMemo(() => {
        if (!activities.length) return [];

        let startDate: Date | null = null;
        let endDate: Date | null = null;

        return activities.filter((item) => {
            const matchesSearch =
                search.trim() === "" ||
                Object.values(item).some((val) =>
                    val?.toString().toLowerCase().includes(search.toLowerCase())
                );

            if (!matchesSearch) return false;

            // New filters here
            if (statusFilter && item.status !== statusFilter) return false;

            return true;
        });
    }, [activities, search, statusFilter]);


    const pageCount = Math.ceil(filteredActivities.length / PAGE_SIZE);

    const paginatedActivities = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredActivities.slice(start, start + PAGE_SIZE);
    }, [filteredActivities, page]);

    function handleInputChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    }

    async function handleSubmit() {
        try {
            if (!supabase) throw new Error("Supabase not initialized");
            const { data, error } = await supabase
                .from("tickets")
                .insert([{ ...form, referenceid }]);

            if (error) throw error;

            toast.success("Ticket created successfully!");
            fetchActivities();
            setOpen(false);
            resetForm();
        } catch (error: any) {
            toast.error(error.message || "Error creating ticket");
        }
    }

    async function handleUpdate() {
        if (!editingId) return;

        const payload = {
            ...form,
            ...(form.status === "Resolved" && {
                date_closed: new Date().toISOString(),
            }),
        };

        if (!supabase) {
            toast.error("Supabase not initialized");
            return;
        }
        const { error } = await supabase
            .from("tickets")
            .update(payload)
            .eq("id", editingId);

        if (error) {
            toast.error(error.message);
            return;
        }

        toast.success("Ticket updated");
        setOpen(false);
        resetForm();
    }

    function resetForm() {
        setForm({
            ticket_id: "",
            requestor_name: "",
            ticket_subject: "",
            department: "",
            mode: "",
            status: "",
            remarks: "",
        });
        setEditingId(null);
    }

    function openEditDialog(item: RequestItem) {
        setEditingId(item.id);
        setForm({
            ticket_id: item.ticket_id ?? "",
            requestor_name: fullname ?? "",
            ticket_subject: item.ticket_subject ?? "",
            department: department ?? "",
            mode: item.mode ?? "",
            status: item.status ?? "",
            remarks: item.remarks ?? "",
        });
        setOpen(true);
    }

    function toggleSelect(id: string) {
        setSelectedIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    }

    function toggleSelectAll() {
        const allSelected = paginatedActivities.every((item) => selectedIds.has(item.id));
        if (allSelected) {
            setSelectedIds((prev) => {
                const newSet = new Set(prev);
                paginatedActivities.forEach((item) => newSet.delete(item.id));
                return newSet;
            });
        } else {
            setSelectedIds((prev) => {
                const newSet = new Set(prev);
                paginatedActivities.forEach((item) => newSet.add(item.id));
                return newSet;
            });
        }
    }

    async function handleDeleteSelected() {
        if (selectedIds.size === 0) return;
        setConfirmDeleteOpen(true);
    }

    async function confirmDeletion() {
        try {
            if (!supabase) throw new Error("Supabase not initialized");
            const { data, error } = await supabase
                .from("tickets")
                .delete()
                .in("id", Array.from(selectedIds));

            if (error) throw error;

            toast.success(`${selectedIds.size} item(s) deleted successfully.`);
            setSelectedIds(new Set());
            setConfirmDeleteOpen(false);
            fetchActivities();
        } catch (error: any) {
            toast.error(error.message || "Error deleting ticket items");
            setConfirmDeleteOpen(false);
        }
    }

    function getStatusBadge(status?: string) {
        switch (status) {
            case "Ongoing":
                return "bg-orange-500 text-white";
            case "Pending":
                return "bg-gray-100 text-gray-800";
            case "Resolved":
                return "bg-green-500 text-white";
            case "Scheduled":
                return "bg-yellow-500 text-white";
            default:
                return "bg-secondary text-white"; // fallback
        }
    }

    function formatDateCreated(dateStr?: string): string {
        if (!dateStr) return "-";
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return "-";

        // Example format: Jan 17, 2026 10:30 AM
        return date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        });
    }

    if (errorActivities) {
        return (
            <Alert variant="destructive" className="flex flex-col space-y-4 p-4 text-xs">
                <div className="flex items-center space-x-3">
                    <AlertCircleIcon className="h-6 w-6 text-red-600" />
                    <div>
                        <AlertTitle>No Data Found or No Network Connection</AlertTitle>
                        <AlertDescription className="text-xs">
                            Please check your internet connection or try again later.
                        </AlertDescription>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    <CheckCircle2Icon className="h-6 w-6 text-green-600" />
                    <div>
                        <AlertTitle className="text-black">Create New Data</AlertTitle>
                        <AlertDescription className="text-xs">
                            You can start by adding new entries to populate your database.
                        </AlertDescription>
                    </div>
                </div>
            </Alert>
        );
    }

    return (
        <Card className="w-full p-4 rounded-xl flex flex-col">
            <CardHeader className="p-0 mb-2">
                <div className="flex items-center justify-between">
                    {/* Left side: Search bar */}
                    <Input
                        placeholder="Search Tickets..."
                        className="text-xs max-w-[400px]"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                            setSelectedIds(new Set());
                        }}
                    />

                    {/* Right side: buttons grouped */}
                    <div className="flex items-center space-x-2">
                        <Button className="bg-black text-white px-8 py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-200" onClick={() => setFilterOpen(true)}>
                            Filters
                        </Button>

                        {selectedIds.size > 0 && (
                            <Button className="bg-black text-white px-8 py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-200" onClick={handleDeleteSelected}>
                                Delete Selected ({selectedIds.size})
                            </Button>
                        )}

                        <Button className="bg-black text-white px-8 py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-200"
                            onClick={() => {
                                resetForm();
                                setOpen(true);
                            }}
                        >
                            Create Ticket
                        </Button>
                    </div>
                </div>

            </CardHeader>

            {loadingActivities ? (
                <div className="flex justify-center py-10">
                    <Spinner />
                </div>
            ) : filteredActivities.length === 0 ? (
                <div className="text-muted-foreground text-sm p-3 border rounded-lg text-center">
                    No ticket data available.
                </div>
            ) : (
                <>
                    <Table className="text-xs">
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    <input
                                        type="checkbox"
                                        onChange={toggleSelectAll}
                                        checked={
                                            paginatedActivities.length > 0 &&
                                            paginatedActivities.every((item) => selectedIds.has(item.id))
                                        }
                                        aria-label="Select all items on page"
                                    />
                                </TableHead>
                                <TableHead>Edit</TableHead>
                                <TableHead>Ticket ID</TableHead>
                                <TableHead>Ticket Subject</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Requestor's Fullname</TableHead>
                                <TableHead>Department</TableHead>
                                <TableHead>Actions</TableHead>
                                <TableHead>Date Created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedActivities.map((item) => (
                                <TableRow key={item.id} className="odd:bg-white even:bg-gray-50">
                                    <TableCell>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(item.id)}
                                            onChange={() => toggleSelect(item.id)}
                                            aria-label={`Select item ${item.requestor_name || item.id}`}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Button size="sm" variant="outline" onClick={() => openEditDialog(item)}>
                                            Edit
                                        </Button>
                                    </TableCell>
                                    <TableCell>{item.ticket_id || "-"}</TableCell>
                                    <TableCell className="capitalize">{item.ticket_subject || "-"}</TableCell>
                                    <TableCell>
                                        <Badge
                                            className={`inline-block px-2 font-semibold ${getStatusBadge(item.status)}`}
                                        >
                                            {item.status || "-"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="uppercase">{item.requestor_name || "-"}</TableCell>
                                    <TableCell>{item.remarks || "-"}</TableCell>
                                    <TableCell>{formatDateCreated(item.date_created)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>

                    <div className="flex justify-end mt-4">
                        <Pagination>
                            <PaginationContent className="flex items-center space-x-4">
                                <PaginationItem>
                                    <PaginationPrevious
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (page > 1) setPage(page - 1);
                                        }}
                                        aria-disabled={page <= 1}
                                        className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                                    />
                                </PaginationItem>

                                <div className="px-4 font-medium">
                                    {pageCount === 0 ? "0 / 0" : `${page} / ${pageCount}`}
                                </div>

                                <PaginationItem>
                                    <PaginationNext
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (page < pageCount) setPage(page + 1);
                                        }}
                                        aria-disabled={page >= pageCount}
                                        className={page >= pageCount ? "pointer-events-none opacity-50" : ""}
                                    />
                                </PaginationItem>
                            </PaginationContent>
                        </Pagination>
                    </div>
                </>
            )}

            <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Filter Tickets</DialogTitle>
                        <DialogDescription>
                            Apply filters to narrow down the ticket list.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {/* Status Filter */}
                        <div>
                            <label htmlFor="status" className="block font-medium text-sm mb-1">Status</label>
                            <select
                                id="status"
                                className="w-full border rounded px-2 py-1"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option value="">All</option>
                                <option value="Ongoing">Ongoing</option>
                                <option value="Pending">Pending</option>
                                <option value="Resolved">Resolved</option>
                                <option value="Scheduled">Scheduled</option>
                            </select>
                        </div>
                    </div>

                    <DialogFooter className="flex justify-end space-x-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setStatusFilter("");
                                setRequestTypeFilter("");
                                setPriorityFilter("");
                            }}
                        >
                            Clear Filters
                        </Button>
                        <Button onClick={() => setFilterOpen(false)}>Apply</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ReceivedDialog
                open={open}
                setOpen={setOpen}
                editingId={editingId}
                form={form}
                handleInputChange={handleInputChange}
                handleSelectChange={handleSelectChange}
                handleSubmit={handleSubmit}
                handleUpdate={handleUpdate}
                resetForm={resetForm}
                fullname={fullname}
                department={department}
                existingTicketIds={existingTicketIds}
            />

            <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirm Deletion</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete{" "}
                            <strong>{selectedIds.size}</strong> selected item
                            {selectedIds.size > 1 ? "s" : ""}?
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmDeletion}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};