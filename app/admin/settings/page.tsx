"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { toast } from "sonner";
import { 
    ArrowLeft,
    Loader2,
    Settings,
    Clock,
    Megaphone,
    Save,
    Calendar,
    Bell,
    ShieldCheck
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= PAGE ================= */

export default function AdminSettingsPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <AdminSettingsContent />
            </FormatProvider>
        </UserProvider>
    );
}

function AdminSettingsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [adminDetails, setAdminDetails] = useState<{ Firstname: string; Lastname: string } | null>(null);

    const [settings, setSettings] = useState({
        officeStartTime: "08:00",
        officeEndTime: "17:00",
        lunchStart: "12:00",
        lunchEnd: "13:00",
        gracePeriod: 15,
        themeColor: "red",
        logoUrl: "",
        announcement: ""
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
                setAdminDetails({ Firstname: data.Firstname, Lastname: data.Lastname });
                setVerifying(false);
            } catch (err) {
                console.error(err);
                router.push("/Login");
            }
        };

        verifyAdmin();
    }, [queryUserId, router]);

    /* ================= FETCH SETTINGS ================= */

    useEffect(() => {
        if (!verifying) {
            const fetchSettings = async () => {
                try {
                    setLoading(true);
                    const res = await fetch("/api/admin/settings");
                    if (res.ok) {
                        const data = await res.json();
                        setSettings({
                            officeStartTime: data.officeStartTime || "08:00",
                            officeEndTime: data.officeEndTime || "17:00",
                            lunchStart: data.lunchStart || "12:00",
                            lunchEnd: data.lunchEnd || "13:00",
                            gracePeriod: data.gracePeriod || 15,
                            themeColor: data.themeColor || "red",
                            logoUrl: data.logoUrl || "",
                            announcement: data.announcement || ""
                        });
                    }
                } catch (err) {
                    console.error(err);
                    toast.error("Failed to load settings");
                } finally {
                    setLoading(false);
                }
            };
            fetchSettings();
        }
    }, [verifying]);

    /* ================= HANDLERS ================= */

    const handleBack = () => {
        router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting(true);
            const res = await fetch("/api/admin/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...settings,
                    adminId: userId,
                    adminName: adminDetails ? `${adminDetails.Firstname} ${adminDetails.Lastname}` : "Admin"
                })
            });

            if (!res.ok) throw new Error("Failed to update settings");

            toast.success("System settings updated successfully");
        } catch (err: any) {
            toast.error(err.message);
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
                                    System Settings
                                </BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                </header>

                <main className="flex-1 overflow-auto p-4 md:p-8 lg:p-12">
                    <div className="mx-auto max-w-4xl flex flex-col gap-8">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-gray-900">System Configuration</h1>
                            <p className="text-sm text-gray-500 mt-1">Global rules and announcements for the entire system.</p>
                        </div>

                        <form onSubmit={handleSave} className="grid gap-6">
                            {/* Work Rules */}
                            <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
                                <CardHeader className="p-8 pb-4">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-brand-primary">
                                            <Clock size={20} />
                                        </div>
                                        <CardTitle className="text-xl font-bold">Attendance Rules</CardTitle>
                                    </div>
                                    <CardDescription>Configure when employees are marked late and their grace period.</CardDescription>
                                </CardHeader>
                                <CardContent className="p-8 pt-4 space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <Label htmlFor="officeStartTime" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Office Start Time</Label>
                                            <Input 
                                                id="officeStartTime" 
                                                type="time" 
                                                value={settings.officeStartTime}
                                                onChange={(e) => setSettings(prev => ({ ...prev, officeStartTime: e.target.value }))}
                                                className="rounded-2xl border-gray-100 h-14 bg-gray-50/50 focus:bg-white transition-all px-6 font-bold text-lg"
                                            />
                                            <p className="text-[10px] text-gray-400 ml-1">The official start of the work day.</p>
                                        </div>
                                        <div className="space-y-3">
                                            <Label htmlFor="officeEndTime" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Office End Time</Label>
                                            <Input 
                                                id="officeEndTime" 
                                                type="time" 
                                                value={settings.officeEndTime}
                                                onChange={(e) => setSettings(prev => ({ ...prev, officeEndTime: e.target.value }))}
                                                className="rounded-2xl border-gray-100 h-14 bg-gray-50/50 focus:bg-white transition-all px-6 font-bold text-lg"
                                            />
                                            <p className="text-[10px] text-gray-400 ml-1">The official end of the work day.</p>
                                        </div>
                                    </div>

                                    <Separator className="bg-gray-50" />

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <Label htmlFor="lunchStart" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Lunch Break Start</Label>
                                            <Input 
                                                id="lunchStart" 
                                                type="time" 
                                                value={settings.lunchStart}
                                                onChange={(e) => setSettings(prev => ({ ...prev, lunchStart: e.target.value }))}
                                                className="rounded-2xl border-gray-100 h-14 bg-gray-50/50 focus:bg-white transition-all px-6 font-bold text-lg"
                                            />
                                            <p className="text-[10px] text-gray-400 ml-1">Start time of the unpaid lunch break.</p>
                                        </div>
                                        <div className="space-y-3">
                                            <Label htmlFor="lunchEnd" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Lunch Break End</Label>
                                            <Input 
                                                id="lunchEnd" 
                                                type="time" 
                                                value={settings.lunchEnd}
                                                onChange={(e) => setSettings(prev => ({ ...prev, lunchEnd: e.target.value }))}
                                                className="rounded-2xl border-gray-100 h-14 bg-gray-50/50 focus:bg-white transition-all px-6 font-bold text-lg"
                                            />
                                            <p className="text-[10px] text-gray-400 ml-1">End time of the unpaid lunch break.</p>
                                        </div>
                                    </div>

                                    <Separator className="bg-gray-50" />

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-3">
                                            <Label htmlFor="gracePeriod" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Grace Period (Minutes)</Label>
                                            <div className="relative">
                                                <Input 
                                                    id="gracePeriod" 
                                                    type="number" 
                                                    value={settings.gracePeriod}
                                                    onChange={(e) => setSettings(prev => ({ ...prev, gracePeriod: parseInt(e.target.value) }))}
                                                    className="rounded-2xl border-gray-100 h-14 bg-gray-50/50 focus:bg-white transition-all px-6 font-bold text-lg"
                                                />
                                                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-300 uppercase">Minutes</span>
                                            </div>
                                            <p className="text-[10px] text-gray-400 ml-1">Additional time allowed before being marked as late.</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* UI Customization */}
                            <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
                                <CardHeader className="p-8 pb-4">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                                            <Settings size={20} />
                                        </div>
                                        <CardTitle className="text-xl font-bold">UI & Branding</CardTitle>
                                    </div>
                                    <CardDescription>Customize the application theme and branding assets.</CardDescription>
                                </CardHeader>
                                <CardContent className="p-8 pt-4 space-y-8">
                                    <div className="space-y-4">
                                        <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Primary Theme Color</Label>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            {[
                                                { id: "red", label: "Red (Default)", color: "bg-[#CC1318]" },
                                                { id: "blue", label: "Blue", color: "bg-[#1E40AF]" },
                                                { id: "black", label: "Black", color: "bg-[#111827]" },
                                                { id: "green", label: "Green", color: "bg-[#15803D]" }
                                            ].map((theme) => (
                                                <button
                                                    key={theme.id}
                                                    type="button"
                                                    onClick={() => setSettings(prev => ({ ...prev, themeColor: theme.id }))}
                                                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${
                                                        settings.themeColor === theme.id 
                                                            ? "border-brand-primary bg-gray-50 shadow-md" 
                                                            : "border-gray-100 hover:border-gray-200"
                                                    }`}
                                                >
                                                    <div className={`w-6 h-6 rounded-full ${theme.color} shadow-sm`} />
                                                    <span className="text-sm font-bold text-gray-700">{theme.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <Separator className="bg-gray-50" />

                                    <div className="space-y-3">
                                        <Label htmlFor="logoUrl" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Custom Logo URL (Optional)</Label>
                                        <Input 
                                            id="logoUrl"
                                            value={settings.logoUrl}
                                            onChange={(e) => setSettings(prev => ({ ...prev, logoUrl: e.target.value }))}
                                            placeholder="https://example.com/logo.png"
                                            className="rounded-2xl border-gray-100 h-14 bg-gray-50/50 focus:bg-white transition-all px-6 font-medium"
                                        />
                                        <p className="text-[10px] text-gray-400 ml-1">If empty, the default system logo will be used.</p>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Announcements */}
                            <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
                                <CardHeader className="p-8 pb-4">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
                                            <Megaphone size={20} />
                                        </div>
                                        <CardTitle className="text-xl font-bold">Global Announcement</CardTitle>
                                    </div>
                                    <CardDescription>Broadcast important messages to all employees on their dashboard.</CardDescription>
                                </CardHeader>
                                <CardContent className="p-8 pt-4 space-y-6">
                                    <div className="space-y-3">
                                        <Label htmlFor="announcement" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Message Content</Label>
                                        <Textarea 
                                            id="announcement"
                                            value={settings.announcement}
                                            onChange={(e) => setSettings(prev => ({ ...prev, announcement: e.target.value }))}
                                            placeholder="Write your announcement here..."
                                            className="rounded-[2rem] border-gray-100 min-h-[160px] bg-gray-50/50 focus:bg-white transition-all p-6 text-base"
                                        />
                                    </div>
                                    
                                    <div className="flex items-center gap-3 p-4 bg-purple-50/50 rounded-2xl border border-purple-100">
                                        <Bell size={18} className="text-purple-400" />
                                        <p className="text-xs text-purple-700 font-medium">This message will be visible to everyone immediately after saving.</p>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Save Button */}
                            <div className="flex justify-end pt-4">
                                <Button 
                                    type="submit" 
                                    disabled={submitting || loading}
                                    className="bg-brand-primary hover:bg-brand-primary-hover text-white rounded-2xl h-14 px-12 font-bold shadow-xl shadow-brand-primary/20 transition-all active:scale-95 gap-3"
                                >
                                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save size={20} />}
                                    Save System Settings
                                </Button>
                            </div>
                        </form>
                    </div>
                </main>
            </div>
        </ProtectedPageWrapper>
    );
}
