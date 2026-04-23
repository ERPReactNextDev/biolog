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
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { Plus, Pencil, Trash2, Loader2, X, AlignLeft, Save, Briefcase, MapPin, Clock, ListChecks } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

import { JobSheet } from "@/components/job-posting-sheet";
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
            // ignore
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

    const [jobs, setJobs] = useState<any[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // --- Form States ---
    const [jobTitle, setJobTitle] = useState("");
    const [category, setCategory] = useState("Sales");
    const [jobType, setJobType] = useState("Full Time");
    const [location, setLocation] = useState("");
    const [qualifications, setQualifications] = useState<string[]>([""]);
    const [status, setStatus] = useState("Open");

    useEffect(() => {
        const q = query(collection(db, "careers"), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setJobs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, []);

    const addQualification = () => setQualifications([...qualifications, ""]);

    const removeQualification = (index: number) => {
        setQualifications(qualifications.filter((_, i) => i !== index));
    };

    const updateQualification = (index: number, value: string) => {
        const newQuals = [...qualifications];
        newQuals[index] = value;
        setQualifications(newQuals);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const filteredQuals = qualifications.filter(q => q.trim() !== "");

        if (!jobTitle || filteredQuals.length === 0 || !location) {
            toast.error("Headline, Location, at least one Qualification ay required.");
            return;
        }

        const toastId = toast.loading(
            editingId ? "Ina-update ang job..." : "Nagdada-dag ng job..."
        );

        setLoading(true);

        try {
            const jobData = {
                title: jobTitle,
                category,
                jobType,
                location,
                qualifications: filteredQuals,
                status,
                updatedAt: serverTimestamp(),
            };

            if (editingId) {
                await updateDoc(doc(db, "careers", editingId), jobData);
                toast.success("Job updated successfully!", { id: toastId });
            } else {
                await addDoc(collection(db, "careers"), {
                    ...jobData,
                    createdAt: serverTimestamp(),
                });
                toast.success("Job created successfully!", { id: toastId });
            }

            setIsModalOpen(false);
            resetForm();
        } catch (err) {
            toast.error("May error sa pag-save ng job.", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setJobTitle("");
        setCategory("Sales");
        setJobType("Full Time");
        setLocation("");
        setQualifications([""]);
        setStatus("Open");
    };

    const handleDelete = async (id: string) => {
        const toastId = toast.loading("Tinatanggal ang job...");

        try {
            await deleteDoc(doc(db, "careers", id));
            toast.success("Job deleted successfully!", { id: toastId });
        } catch (err) {
            toast.error("Failed to delete job.", { id: toastId });
        }
    };

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
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                    <div>
                                        <h2 className="text-3xl font-black text-gray-900 uppercase tracking-tighter italic">Talent <span className="text-[#d11a2a]">Acquisition</span></h2>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Recruit and manage team opportunities</p>
                                    </div>
                                    <Button
                                        onClick={() => { resetForm(); setIsModalOpen(true); }}
                                        className="bg-black text-white px-8 py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-200"
                                    >
                                        <Plus size={18} /> Post Job Vacancy
                                    </Button>
                                </div>

                                {/* JOB LIST TABLE */}
                                <div className="bg-white rounded border border-gray-100 shadow-sm overflow-hidden mt-8">
                                    <table className="w-full text-left">
                                        <thead className="bg-gray-50/50 border-b border-gray-100 text-[10px] font-black uppercase text-gray-400 tracking-[0.2em]">
                                            <tr>
                                                <th className="px-8 py-6">Position / Role</th>
                                                <th className="px-8 py-6">Category</th>
                                                <th className="px-8 py-6">Location</th>
                                                <th className="px-8 py-6">Type</th>
                                                <th className="px-8 py-6 text-center">Status</th>
                                                <th className="px-8 py-6 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {jobs.map(job => (
                                                <tr key={job.id} className="hover:bg-gray-50/30 transition-colors group">
                                                    <td className="px-8 py-6">
                                                        <h4 className="font-black text-gray-900 uppercase text-sm tracking-tight">{job.title}</h4>
                                                    </td>
                                                    <td className="px-8 py-6">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{job.category}</span>
                                                    </td>
                                                    <td className="px-8 py-6">
                                                        <div className="flex items-center gap-2 text-gray-500 font-bold text-xs uppercase">
                                                            <MapPin size={14} className="text-[#d11a2a]" /> {job.location}
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6">
                                                        <span className="text-[10px] font-black uppercase text-gray-900 bg-gray-100 px-3 py-1 rounded-lg">
                                                            {job.jobType}
                                                        </span>
                                                    </td>
                                                    <td className="px-8 py-6 text-center">
                                                        <span className={`text-[9px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full ${job.status === 'Open' ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'
                                                            }`}>
                                                            {job.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button onClick={() => {
                                                                setEditingId(job.id); setJobTitle(job.title); setCategory(job.category);
                                                                setJobType(job.jobType); setLocation(job.location);
                                                                setQualifications(Array.isArray(job.qualifications) ? job.qualifications : [job.qualifications]);
                                                                setStatus(job.status); setIsModalOpen(true);
                                                            }} className="p-3 bg-gray-50 text-gray-400 hover:bg-black hover:text-white rounded-xl transition-all"><Pencil size={16} /></button>
                                                            <button
                                                                onClick={() => handleDelete(job.id)}
                                                                className="p-3 text-red-500 hover:bg-red-500 hover:text-white rounded-xl transition-all"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>

                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* FULL-HEIGHT SIDE MODAL */}
                                <AnimatePresence>
                                    {isModalOpen && (
                                        <JobSheet
                                            isOpen={isModalOpen}
                                            onClose={() => setIsModalOpen(false)}
                                            jobTitle={jobTitle}
                                            setJobTitle={setJobTitle}
                                            category={category}
                                            setCategory={setCategory}
                                            jobType={jobType}
                                            setJobType={setJobType}
                                            location={location}
                                            setLocation={setLocation}
                                            status={status}
                                            setStatus={setStatus}
                                            qualifications={qualifications}
                                            setQualifications={setQualifications}
                                            loading={loading}
                                            editingId={editingId}
                                            handleSubmit={handleSubmit}
                                            addQualification={addQualification}
                                            updateQualification={updateQualification}
                                            removeQualification={removeQualification}
                                        />
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
