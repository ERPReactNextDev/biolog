"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { type DateRange } from "react-day-picker";
import { AppSidebar } from "@/components/app-sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger, } from "@/components/ui/sidebar";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    doc,
    deleteDoc,
    updateDoc,
    where
} from "firebase/firestore";
import {
    Mail,
    Phone,
    FileText,
    Calendar,
    Briefcase,
    Trash2,
    ExternalLink,
    Search,
    User,
    CheckCircle,
    Clock,
    X,
    ChevronRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

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

export default function Page() {
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const queryUserId = searchParams?.get("id") ?? "";

    const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [dateCreatedFilterRange, setDateCreatedFilterRange] = useState<
        DateRange | undefined
    >(undefined);

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

        }
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

    useEffect(() => {
        if (queryUserId && queryUserId !== userId) {
            setUserId(queryUserId);
        }
    }, [queryUserId, userId, setUserId]);

    useEffect(() => {
        const fetchUserData = async () => {
            if (!queryUserId) {
                setError("User ID is missing.");
                return;
            }
            setError(null);
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

    const [applications, setApplications] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedApp, setSelectedApp] = useState<any | null>(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

    useEffect(() => {
        const q = query(
            collection(db, "inquiries"),
            where("type", "==", "job"),
            orderBy("appliedAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const appList = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setApplications(appList);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const formatDateTime = (timestamp: any) => {
        if (!timestamp) return "---";
        const date = timestamp.toDate();
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(date);
    };

    const markAsRead = async (id: string, currentStatus: string) => {
        if (currentStatus === "unread") {
            try {
                await updateDoc(doc(db, "inquiries", id), { status: "read" });
                toast.success("Application marked as read");
            } catch (error) {
                toast.error("Failed to mark application as read");
            }
        }
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeleteTargetId(id);
        setShowDeleteDialog(true);
    };

    // ACTUAL deletion kapag na-confirm
    const confirmDelete = async () => {
        if (!deleteTargetId) return;

        try {
            await deleteDoc(doc(db, "inquiries", deleteTargetId));
            toast.success("Application deleted successfully");
            if (selectedApp?.id === deleteTargetId) setSelectedApp(null);
        } catch (error) {
            toast.error("Failed to delete application");
        } finally {
            setShowDeleteDialog(false);
            setDeleteTargetId(null);
        }
    };

    // Cancel delete dialog
    const cancelDelete = () => {
        setShowDeleteDialog(false);
        setDeleteTargetId(null);
    };

    const toggleInternalStatus = async (e: React.MouseEvent, id: string, currentStatus: string) => {
        e.stopPropagation();
        const nextStatus = currentStatus === "reviewed" ? "pending" : "reviewed";
        try {
            await updateDoc(doc(db, "inquiries", id), { internalStatus: nextStatus });
            toast.success(`Application status updated to ${nextStatus}`);
        } catch (error) {
            toast.error("Failed to update application status");
        }
    };

    const filteredApps = applications.filter(app =>
        app.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase())
    );


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
                                            <BreadcrumbPage>Job Posting</BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </BreadcrumbList>
                                </Breadcrumb>
                            </header>

                            <div className="p-6">
                                {/* HEADER PANEL */}
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Job Applications</h2>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Manage resumes and candidates</p>
                                    </div>
                                    <div className="relative group">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#d11a2a] transition-colors" size={18} />
                                        <input
                                            type="text"
                                            placeholder="Search candidates..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="pl-12 pr-6 py-4 bg-white border border-gray-100 rounded-2xl w-full md:w-80 shadow-sm focus:ring-2 focus:ring-[#d11a2a]/10 outline-none font-medium text-sm transition-all"
                                        />
                                    </div>
                                </div>

                                {/* JOB LIST TABLE */}
                                <div className="grid grid-cols-1 gap-4 mt-4">
                                    <AnimatePresence mode="popLayout">
                                        {filteredApps.map((app) => (
                                            <motion.div
                                                key={app.id}
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                onClick={() => {
                                                    setSelectedApp(app);
                                                    markAsRead(app.id, app.status);
                                                }}
                                                className={`bg-white border p-6 rounded-[1rem] hover:shadow-xl transition-all group cursor-pointer ${app.status === "unread" ? "border-l-4 border-l-[#d11a2a] border-gray-100" : "border-gray-100"
                                                    }`}
                                            >
                                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                                    <div className="flex items-start gap-5">
                                                        <div className="relative">
                                                            <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center shrink-0 group-hover:bg-red-50 transition-colors">
                                                                <User className="text-gray-400 group-hover:text-[#d11a2a]" size={24} />
                                                            </div>
                                                            {app.status === "unread" && (
                                                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#d11a2a] rounded-full border-2 border-white animate-pulse" />
                                                            )}
                                                        </div>
                                                        <div className="space-y-1">
                                                            <h3 className="text-lg font-black text-gray-900 leading-none">{app.fullName}</h3>
                                                            <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-gray-400 uppercase tracking-wider">
                                                                <span className="flex items-center gap-1 text-[#d11a2a]">
                                                                    <Briefcase size={12} /> {app.jobTitle}
                                                                </span>
                                                                <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-md">
                                                                    <Calendar size={12} className="text-gray-400" />
                                                                    {formatDateTime(app.appliedAt)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={(e) => toggleInternalStatus(e, app.id, app.internalStatus)}
                                                            className={`p-3 rounded-xl transition-all ${app.internalStatus === "reviewed" ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400 hover:bg-green-50"}`}
                                                        >
                                                            <CheckCircle size={18} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDeleteClick(e, app.id)}
                                                            className="p-3 bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                        <ChevronRight className="text-gray-300 group-hover:translate-x-1 transition-transform" />
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                    {filteredApps.length === 0 && (
                                        <div className="text-center py-20 bg-white rounded-[2rem] border border-dashed border-gray-200">
                                            <p className="text-xs font-black text-gray-300 uppercase tracking-[0.3em]">No applications found</p>
                                        </div>
                                    )}
                                </div>

                                <AnimatePresence>
                                    {showDeleteDialog && (
                                        <motion.div
                                            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                        >
                                            <motion.div
                                                className="bg-white rounded-3xl p-8 max-w-md w-full shadow-lg"
                                                initial={{ scale: 0.8, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                exit={{ scale: 0.8, opacity: 0 }}
                                            >
                                                <h3 className="text-xl font-bold mb-4 text-center">Confirm Deletion</h3>
                                                <p className="text-center text-gray-600 mb-8">Are you sure you want to delete this application? This action cannot be undone.</p>
                                                <div className="flex justify-center gap-6">
                                                    <button
                                                        onClick={cancelDelete}
                                                        className="px-6 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={confirmDelete}
                                                        className="px-6 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 transition"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </motion.div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* Modal/Dialog Section */}
                                <AnimatePresence>
                                    {selectedApp && (
                                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                                            <motion.div
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                onClick={() => setSelectedApp(null)}
                                                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                                            />
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                                className="relative bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
                                            >
                                                <div className="p-8 md:p-12">
                                                    <button
                                                        onClick={() => setSelectedApp(null)}
                                                        className="absolute top-8 right-8 p-2 hover:bg-gray-100 rounded-full transition-colors"
                                                    >
                                                        <X size={20} className="text-gray-400" />
                                                    </button>
                                                    <div className="flex items-center gap-6 mb-8">
                                                        <div className="w-20 h-20 bg-red-50 rounded-[2rem] flex items-center justify-center">
                                                            <User className="text-[#d11a2a]" size={40} />
                                                        </div>
                                                        <div>
                                                            <h2 className="text-3xl font-black text-gray-900 tracking-tighter uppercase">{selectedApp.fullName}</h2>
                                                            <p className="text-[#d11a2a] font-bold uppercase tracking-widest text-sm">{selectedApp.jobTitle}</p>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                                                        <div className="space-y-4">
                                                            <div className="flex items-center gap-4">
                                                                <div className="p-3 bg-gray-50 rounded-2xl"><Mail size={20} className="text-gray-400" /></div>
                                                                <div>
                                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Email Address</p>
                                                                    <p className="font-bold text-gray-700">{selectedApp.email}</p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-4">
                                                                <div className="p-3 bg-gray-50 rounded-2xl"><Phone size={20} className="text-gray-400" /></div>
                                                                <div>
                                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Phone Number</p>
                                                                    <p className="font-bold text-gray-700">{selectedApp.phone}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="space-y-4">
                                                            <div className="flex items-center gap-4">
                                                                <div className="p-3 bg-gray-50 rounded-2xl"><Calendar size={20} className="text-gray-400" /></div>
                                                                <div>
                                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Applied On</p>
                                                                    <p className="font-bold text-gray-700">{formatDateTime(selectedApp.appliedAt)}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex flex-col sm:flex-row gap-4">
                                                        <a
                                                            href={selectedApp.resumeUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex-1 inline-flex items-center justify-center gap-3 px-8 py-5 bg-gray-900 text-white rounded-2xl text-xs font-black uppercase tracking-[0.2em] hover:bg-[#d11a2a] transition-all"
                                                        >
                                                            <FileText size={18} /> View CV <ExternalLink size={14} />
                                                        </a>
                                                        <button
                                                            onClick={() => setSelectedApp(null)}
                                                            className="px-8 py-5 border-2 border-gray-100 text-gray-400 rounded-2xl text-xs font-black uppercase tracking-[0.2em] hover:bg-gray-50 transition-all"
                                                        >
                                                            Close
                                                        </button>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        </div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </SidebarInset>
                    </SidebarProvider>
                </FormatProvider>
            </UserProvider>
        </ProtectedPageWrapper>
    );
}
