"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { format } from "date-fns";
import { toast } from "sonner";
import { 
    ArrowLeft,
    Loader2,
    MapPin,
    Clock,
    Search,
    RefreshCw,
    Building2,
    Navigation,
    PanelLeftClose,
    PanelLeftOpen,
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
import { Badge } from "@/components/ui/badge";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= DYNAMIC IMPORTS ================= */

const MapContainer = dynamic(() => import("react-leaflet").then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((mod) => mod.Popup), { ssr: false });

/* ================= TYPES ================= */

interface UserItem {
    ReferenceID: string;
    Firstname: string;
    Lastname: string;
    Email: string;
    Department: string;
    profilePicture?: string;
}

interface LocationLog {
    _id: string;
    ReferenceID: string;
    Status: string;
    Location: string;
    Latitude: number;
    Longitude: number;
    date_created: string;
    Type: string;
    SiteVisitAccount?: string;
}

interface UserWithLocation extends UserItem {
    lastLocation?: LocationLog;
}

/* ================= PAGE ================= */

export default function LiveTrackingPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <LiveTrackingContent />
            </FormatProvider>
        </UserProvider>
    );
}

function LiveTrackingContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [usersWithLocation, setUsersWithLocation] = useState<UserWithLocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedUser, setSelectedUser] = useState<UserWithLocation | null>(null);
    const [isLeafletLoaded, setIsLeafletLoaded] = useState(false);

    // ← NEW: sidebar open/close state
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const queryUserId = searchParams?.get("id") ?? "";

    useEffect(() => {
        if (queryUserId && queryUserId !== userId) {
            setUserId(queryUserId);
        }
    }, [queryUserId, userId, setUserId]);

    /* ================= LEAFLET FIX ================= */

    useEffect(() => {
        if (typeof window !== "undefined") {
            import("leaflet").then((leaflet) => {
                delete (leaflet.Icon.Default.prototype as any)._getIconUrl;
                leaflet.Icon.Default.mergeOptions({
                    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
                    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
                    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
                });
                setIsLeafletLoaded(true);
            });
        }
    }, []);

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

            const usersRes = await fetch("/api/admin/users");
            const usersData: UserItem[] = await usersRes.json();

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const params = new URLSearchParams();
            params.append("page", "1");
            params.append("limit", "500");
            params.append("role", "SuperAdmin");
            params.append("startDate", today.toISOString());

            const logsRes = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
            const logsData = await logsRes.json();
            const logs: LocationLog[] = logsData.data || [];

            const usersWithLoc: UserWithLocation[] = usersData.map(user => {
                const userLogs = logs.filter(l => l.ReferenceID === user.ReferenceID && l.Latitude && l.Longitude);
                const lastLoc = userLogs[0];
                return { ...user, lastLocation: lastLoc };
            });

            setUsersWithLocation(usersWithLoc);
        } catch (err) {
            toast.error("Failed to load tracking data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!verifying) {
            fetchData();
        }
    }, [verifying, fetchData]);

    /* ================= FILTERED DATA ================= */

    const filteredUsers = useMemo(() => {
        return usersWithLocation.filter(u =>
            u.lastLocation && (
                `${u.Firstname} ${u.Lastname}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
                u.ReferenceID.toLowerCase().includes(searchQuery.toLowerCase())
            )
        );
    }, [usersWithLocation, searchQuery]);

    /* ================= HANDLERS ================= */

    const handleBack = () => {
        router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
    };

    const handleUserClick = (user: UserWithLocation) => {
        setSelectedUser(user);
    };

    /* ================= RENDER ================= */

    if (verifying || !isLeafletLoaded) {
        return (
            <div className="flex h-screen items-center justify-center bg-brand-bg">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-brand-primary" />
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Initialising map...</p>
                </div>
            </div>
        );
    }

    return (
        <ProtectedPageWrapper>
            <div className="flex h-screen flex-col bg-brand-bg">

                {/* ── Header ── */}
                <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-white px-4 md:px-6 shadow-sm z-30">
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
                                    Live Tracking
                                </BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>

                    <div className="ml-auto flex items-center gap-2">
                        <Badge variant="outline" className="bg-green-50 text-green-600 border-green-100 font-bold uppercase tracking-widest text-[10px] px-3 py-1">
                            {filteredUsers.length} Active Today
                        </Badge>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={fetchData}
                            className="h-9 w-9 rounded-xl text-gray-400 hover:text-brand-primary"
                        >
                            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                        </Button>

                        {/* ← NEW: Sidebar toggle button in header */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSidebarOpen(prev => !prev)}
                            className="h-9 w-9 rounded-xl border border-gray-100 text-gray-500 hover:bg-gray-50 hover:text-brand-primary transition-all"
                            title={sidebarOpen ? "Hide panel" : "Show panel"}
                        >
                            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                        </Button>
                    </div>
                </header>

                {/* ── Body ── */}
                <div className="flex flex-1 overflow-hidden relative">

                    {/* ── Sidebar – slides in/out ── */}
                    <div
                        className={`
                            absolute inset-y-0 left-0 z-20
                            flex flex-col bg-white border-r shadow-xl
                            transition-all duration-300 ease-in-out
                            ${sidebarOpen ? "w-80 opacity-100 pointer-events-auto" : "w-0 opacity-0 pointer-events-none"}
                            overflow-hidden
                        `}
                    >
                        {/* Search */}
                        <div className="p-4 border-b">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
                                <Input
                                    placeholder="Search active users..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 h-11 rounded-xl border-gray-100 bg-gray-50 focus:bg-white transition-all text-sm"
                                />
                            </div>
                        </div>

                        {/* User list */}
                        <div className="flex-1 overflow-y-auto">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-64 gap-3">
                                    <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fetching locations...</p>
                                </div>
                            ) : filteredUsers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 gap-2 text-center p-8">
                                    <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-200">
                                        <MapPin size={24} />
                                    </div>
                                    <p className="text-sm font-bold text-gray-400">No active users found</p>
                                    <p className="text-[10px] text-gray-400 leading-tight">Only users who logged in today with GPS enabled will appear here.</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50">
                                    {filteredUsers.map((user) => (
                                        <button
                                            key={user.ReferenceID}
                                            onClick={() => handleUserClick(user)}
                                            className={`w-full p-4 text-left hover:bg-gray-50 transition-all flex items-start gap-3 group ${selectedUser?.ReferenceID === user.ReferenceID ? "bg-red-50/50" : ""}`}
                                        >
                                            <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-500 font-bold uppercase shadow-inner group-hover:bg-white transition-all">
                                                {user.Firstname[0]}{user.Lastname[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-0.5">
                                                    <span className="font-bold text-gray-900 truncate text-sm">{user.Firstname} {user.Lastname}</span>
                                                    <span className="text-[10px] font-bold text-gray-400 tabular-nums">
                                                        {format(new Date(user.lastLocation!.date_created), "hh:mm aa")}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[10px] font-medium text-gray-500 mb-2">
                                                    <Badge variant="outline" className={`h-4 px-1.5 rounded-sm text-[8px] font-black uppercase ${user.lastLocation!.Status === "Login" ? "bg-green-50 text-green-600 border-green-100" : "bg-orange-50 text-orange-600 border-orange-100"}`}>
                                                        {user.lastLocation!.Status}
                                                    </Badge>
                                                    <span className="truncate">{user.lastLocation!.Type}</span>
                                                </div>
                                                <div className="flex items-start gap-1 text-[9px] text-gray-400 leading-tight">
                                                    <MapPin size={10} className="shrink-0 mt-0.5" />
                                                    <span className="line-clamp-2">{user.lastLocation!.Location}</span>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Map (always full-height, shifts right when sidebar open) ── */}
                    <div
                        className={`
                            absolute inset-y-0 right-0 z-10
                            transition-all duration-300 ease-in-out
                            ${sidebarOpen ? "left-80" : "left-0"}
                        `}
                    >
                        {typeof window !== "undefined" && (
                            <MapContainer
                                center={[14.5995, 120.9842]}
                                zoom={12}
                                style={{ height: "100%", width: "100%" }}
                                zoomControl={false}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                />

                                {filteredUsers.map((user) => (
                                    <Marker
                                        key={user.ReferenceID}
                                        position={[user.lastLocation!.Latitude, user.lastLocation!.Longitude]}
                                        eventHandlers={{
                                            click: () => setSelectedUser(user),
                                        }}
                                    >
                                        <Popup className="rounded-2xl overflow-hidden">
                                            <div className="p-1 min-w-[200px]">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <div className="w-10 h-10 rounded-xl bg-brand-primary text-white flex items-center justify-center font-bold">
                                                        {user.Firstname[0]}{user.Lastname[0]}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-gray-900">{user.Firstname} {user.Lastname}</span>
                                                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">ID: {user.ReferenceID}</span>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-600 bg-gray-50 p-2 rounded-lg">
                                                        <Clock size={12} className="text-brand-primary" />
                                                        {format(new Date(user.lastLocation!.date_created), "hh:mm aa, MMM dd")}
                                                    </div>
                                                    <div className="flex items-start gap-2 text-[10px] text-gray-500 leading-tight">
                                                        <MapPin size={12} className="shrink-0 mt-0.5 text-gray-400" />
                                                        {user.lastLocation!.Location}
                                                    </div>
                                                    {user.lastLocation?.SiteVisitAccount && (
                                                        <div className="flex items-center gap-2 text-[10px] font-bold text-orange-600 bg-orange-50 p-2 rounded-lg border border-orange-100">
                                                            <Building2 size={12} />
                                                            {user.lastLocation.SiteVisitAccount}
                                                        </div>
                                                    )}
                                                </div>
                                                <Button
                                                    className="w-full mt-4 h-8 text-[10px] font-bold uppercase tracking-widest bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg"
                                                    onClick={() => router.push(`/activity-planner?id=${encodeURIComponent(user.ReferenceID)}`)}
                                                >
                                                    View Timeline
                                                </Button>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}
                            </MapContainer>
                        )}

                        {/* ── Floating Controls (top-right of map) ── */}
                        <div className="absolute top-6 right-6 flex flex-col gap-2 z-[400]">
                            <Card className="rounded-2xl border-none shadow-2xl p-2 bg-white/90 backdrop-blur">
                                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-white hover:text-brand-primary transition-all">
                                    <Navigation size={20} />
                                </Button>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </ProtectedPageWrapper>
    );
}