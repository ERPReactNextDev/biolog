"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { toast } from "sonner";
import {
    Search,
    MoreHorizontal,
    Pencil,
    Trash2,
    UserPlus,
    Users as UsersIcon,
    ShieldCheck,
    Building2,
    CheckCircle2,
    XCircle,
    Loader2,
    ArrowLeft,
    RefreshCcw
} from "lucide-react";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
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
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

/* ================= TYPES ================= */

interface UserItem {
    _id: string;
    Firstname: string;
    Lastname: string;
    Email: string;
    Role: string;
    Department: string;
    Status: string;
    Company?: string;
    ReferenceID: string;
    createdAt?: string;
    permissions?: {
        canCreateAttendance: boolean;
        canCreateSiteVisit: boolean;
    };
}

interface UserForm {
    Firstname: string;
    Lastname: string;
    Email: string;
    Password?: string;
    Role: string;
    Department: string;
    ReferenceID: string;
    Status: string;
    Company?: string;
    permissions?: {
        canCreateAttendance: boolean;
        canCreateSiteVisit: boolean;
    };
}

/* ================= SHARED FORM FIELDS ================= */

function UserFormFields({
    formData,
    onInput,
    onSelect,
    onPermission,
    isEdit = false,
}: {
    formData: UserForm;
    onInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSelect: (name: string, value: string) => void;
    onPermission: (perm: string, checked: boolean) => void;
    isEdit?: boolean;
}) {
    return (
        <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor={`${isEdit ? "edit-" : ""}Firstname`} className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">First Name</Label>
                    <Input id={`${isEdit ? "edit-" : ""}Firstname`} name="Firstname" value={formData.Firstname} onChange={onInput} required className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor={`${isEdit ? "edit-" : ""}Lastname`} className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Last Name</Label>
                    <Input id={`${isEdit ? "edit-" : ""}Lastname`} name="Lastname" value={formData.Lastname} onChange={onInput} required className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
                </div>
            </div>

            <div className="grid gap-2">
                <Label htmlFor={`${isEdit ? "edit-" : ""}Email`} className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Email Address</Label>
                <Input id={`${isEdit ? "edit-" : ""}Email`} name="Email" type="email" value={formData.Email} onChange={onInput} required className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
            </div>

            <div className="grid gap-2">
                <Label htmlFor={`${isEdit ? "edit-" : ""}Password`} className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">
                    {isEdit ? "New Password (leave blank to keep current)" : "Password"}
                </Label>
                <Input
                    id={`${isEdit ? "edit-" : ""}Password`}
                    name="Password"
                    type="password"
                    value={formData.Password}
                    onChange={onInput}
                    required={!isEdit}
                    className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4"
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor={`${isEdit ? "edit-" : ""}ReferenceID`} className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Reference ID</Label>
                    <Input id={`${isEdit ? "edit-" : ""}ReferenceID`} name="ReferenceID" value={formData.ReferenceID} onChange={onInput} required className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
                </div>
                <div className="grid gap-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Role</Label>
                    <Select onValueChange={(v) => onSelect("Role", v)} value={formData.Role}>
                        <SelectTrigger className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 px-4">
                            <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl">
                            <SelectItem value="Admin">Admin</SelectItem>
                            <SelectItem value="Manager">Manager</SelectItem>
                            <SelectItem value="User">User</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor={`${isEdit ? "edit-" : ""}Department`} className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Department</Label>
                    <Input id={`${isEdit ? "edit-" : ""}Department`} name="Department" value={formData.Department} onChange={onInput} required className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
                </div>
                {isEdit ? (
                    <div className="grid gap-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Account Status</Label>
                        <Select onValueChange={(v) => onSelect("Status", v)} value={formData.Status}>
                            <SelectTrigger className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 px-4">
                                <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl">
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="Resigned">Resigned</SelectItem>
                                <SelectItem value="Terminated">Terminated</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                ) : (
                    <div className="grid gap-2">
                        <Label htmlFor="Company" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Company (Optional)</Label>
                        <Input id="Company" name="Company" value={formData.Company} onChange={onInput} className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
                    </div>
                )}
            </div>

            {isEdit && (
                <div className="grid gap-2">
                    <Label htmlFor="edit-Company" className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Company (Optional)</Label>
                    <Input id="edit-Company" name="Company" value={formData.Company} onChange={onInput} className="rounded-2xl border-gray-100 h-11 bg-gray-50/50 focus:bg-white px-4" />
                </div>
            )}

            <div className="grid gap-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-gray-400 ml-1">Permissions</Label>
                <div className="grid grid-cols-2 gap-3 bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={`${isEdit ? "edit-" : ""}canCreateAttendance`}
                            checked={formData.permissions?.canCreateAttendance}
                            onCheckedChange={(checked: boolean) => onPermission("canCreateAttendance", checked)}
                        />
                        <label htmlFor={`${isEdit ? "edit-" : ""}canCreateAttendance`} className="text-xs font-semibold text-gray-600 cursor-pointer leading-snug">Attendance (Time In/Out)</label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={`${isEdit ? "edit-" : ""}canCreateSiteVisit`}
                            checked={formData.permissions?.canCreateSiteVisit}
                            onCheckedChange={(checked: boolean) => onPermission("canCreateSiteVisit", checked)}
                        />
                        <label htmlFor={`${isEdit ? "edit-" : ""}canCreateSiteVisit`} className="text-xs font-semibold text-gray-600 cursor-pointer leading-snug">Site Visit</label>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ================= PAGE ================= */

export default function UserManagementPage() {
    return (
        <UserProvider>
            <FormatProvider>
                <UserManagementContent />
            </FormatProvider>
        </UserProvider>
    );
}

function UserManagementContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();

    const [users, setUsers] = useState<UserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(true);
    const [adminDetails, setAdminDetails] = useState<{ Firstname: string; Lastname: string } | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const defaultForm: UserForm = {
        Firstname: "", Lastname: "", Email: "", Password: "",
        Role: "User", Department: "", ReferenceID: "", Status: "Active", Company: "",
        permissions: { canCreateAttendance: true, canCreateSiteVisit: true },
    };

    const [formData, setFormData] = useState<UserForm>(defaultForm);

    const queryUserId = searchParams?.get("id") ?? "";

    useEffect(() => {
        if (queryUserId && queryUserId !== userId) setUserId(queryUserId);
    }, [queryUserId, userId, setUserId]);

    /* Verify admin access */
    useEffect(() => {
        if (!queryUserId) return;
        (async () => {
            try {
                setVerifying(true);
                const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
                if (!res.ok) { router.push("/Login"); return; }
                const data = await res.json();
                if (data.Role !== "Admin" && data.Role !== "Super Admin" && data.Department !== "IT") {
                    toast.error("Unauthorized access");
                    router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
                    return;
                }
                setAdminDetails({ Firstname: data.Firstname, Lastname: data.Lastname });
                setVerifying(false);
            } catch { router.push("/Login"); }
        })();
    }, [queryUserId, router]);

    /* Fetch users */
    const fetchUsers = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/admin/users");
            if (!res.ok) throw new Error();
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : []);
        } catch {
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const filteredUsers = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return users.filter((u) =>
            [u.Firstname, u.Lastname, u.Email, u.ReferenceID, u.Department]
                .some((v) => (v || "").toLowerCase().includes(q))
        );
    }, [users, searchQuery]);

    /* Form handlers */
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handlePermissionChange = (perm: string, checked: boolean) => {
        setFormData((prev) => ({
            ...prev,
            permissions: { ...prev.permissions!, [perm]: checked },
        }));
    };

    const resetForm = () => {
        setFormData(defaultForm);
        setSelectedUser(null);
    };

    const adminName = adminDetails ? `${adminDetails.Firstname} ${adminDetails.Lastname}` : "Admin";

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting(true);
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...formData, adminId: userId, adminName }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to create user");
            }
            toast.success("User created successfully");
            setIsAddDialogOpen(false);
            resetForm();
            fetchUsers();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleEditUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;
        try {
            setSubmitting(true);
            const { Password, ...updateData } = formData;
            const body: any = { userId: selectedUser._id, ...updateData, adminId: userId, adminName };
            if (Password) body.Password = Password;
            const res = await fetch("/api/admin/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to update user");
            }
            toast.success("User updated successfully");
            setIsEditDialogOpen(false);
            resetForm();
            fetchUsers();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteUser = async () => {
        if (!selectedUser) return;
        try {
            setSubmitting(true);
            const res = await fetch("/api/admin/users", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: selectedUser._id, adminId: userId, adminName }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to delete user");
            }
            toast.success("User deleted successfully");
            setIsDeleteDialogOpen(false);
            resetForm();
            fetchUsers();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const openEditDialog = (user: UserItem) => {
        setSelectedUser(user);
        setFormData({
            Firstname: user.Firstname, Lastname: user.Lastname, Email: user.Email,
            Password: "", Role: user.Role, Department: user.Department,
            ReferenceID: user.ReferenceID, Status: user.Status, Company: user.Company || "",
            permissions: user.permissions || { canCreateAttendance: true, canCreateSiteVisit: true },
        });
        setIsEditDialogOpen(true);
    };

    const handleToggleAccess = async (user: UserItem) => {
        const newStatus = user.Status === "Active" ? "Revoked" : "Active";
        try {
            setSubmitting(true);
            const res = await fetch("/api/admin/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: user._id, Status: newStatus, adminId: userId, adminName }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error);
            }
            toast.success(`Access ${newStatus === "Active" ? "granted" : "revoked"} for ${user.Firstname}`);
            fetchUsers();
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (verifying) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#F9F6F4]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-12 w-12 animate-spin text-[#CC1318]" />
                    <p className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Verifying access...</p>
                </div>
            </div>
        );
    }

    /* ── Shared dialog content class: scrollable on mobile ── */
    const dialogContentClass =
        "sm:max-w-[600px] rounded-[2.5rem] border-none shadow-2xl p-0 overflow-hidden " +
        /* Mobile: limit height + allow scrolling without zooming viewport */
        "max-h-[92dvh] flex flex-col";

    return (
        <ProtectedPageWrapper>
            <div className="flex min-h-screen flex-col bg-[#F9F6F4]">
                {/* Header */}
                <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-white px-4 md:px-6 shadow-sm">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`)}
                        className="h-9 w-9 rounded-xl border border-gray-100 text-gray-500 hover:bg-gray-50 hover:text-[#CC1318] transition-all"
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
                                <BreadcrumbPage className="font-bold text-[#CC1318]">User Management</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                </header>

                <main className="flex-1 overflow-auto p-4 md:p-8 lg:p-12">
                    <div className="mx-auto max-w-7xl flex flex-col gap-8">
                        {/* Header Actions */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div>
                                <h1 className="text-3xl font-bold tracking-tight text-gray-900">System Users</h1>
                                <p className="text-sm text-gray-500 mt-1">Manage user accounts, roles, and system permissions.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={fetchUsers}
                                    disabled={loading}
                                    className="h-12 w-12 rounded-2xl border-gray-100 bg-white text-gray-400 hover:text-[#CC1318] transition-all"
                                >
                                    <RefreshCcw size={20} className={loading ? "animate-spin" : ""} />
                                </Button>

                                <Dialog open={isAddDialogOpen} onOpenChange={(o) => { setIsAddDialogOpen(o); if (!o) resetForm(); }}>
                                    <DialogTrigger asChild>
                                        <Button className="bg-[#CC1318] hover:bg-[#A8100F] text-white gap-2 rounded-2xl h-12 px-8 shadow-lg shadow-red-200 font-bold">
                                            <UserPlus size={20} />
                                            Add New User
                                        </Button>
                                    </DialogTrigger>
                                    {/* KEY FIX: flex flex-col + overflow-y-auto on form keeps dialog scrollable without viewport zoom */}
                                    <DialogContent className={dialogContentClass}>
                                        <form onSubmit={handleAddUser} className="flex flex-col flex-1 min-h-0">
                                            <div className="p-6 pb-0 flex-shrink-0">
                                                <DialogHeader>
                                                    <DialogTitle className="text-xl font-bold text-gray-900">Create New User</DialogTitle>
                                                    <DialogDescription className="text-gray-500 text-sm">
                                                        Enter the user's information below to register them in the system.
                                                    </DialogDescription>
                                                </DialogHeader>
                                            </div>
                                            {/* Scrollable body */}
                                            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                                                <UserFormFields
                                                    formData={formData}
                                                    onInput={handleInputChange}
                                                    onSelect={handleSelectChange}
                                                    onPermission={handlePermissionChange}
                                                />
                                            </div>
                                            {/* Sticky footer */}
                                            <div className="flex-shrink-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t">
                                                <Button type="button" variant="ghost" onClick={() => setIsAddDialogOpen(false)} className="rounded-xl h-11 px-6 font-semibold">Cancel</Button>
                                                <Button type="submit" disabled={submitting} className="bg-[#CC1318] hover:bg-[#A8100F] text-white rounded-xl h-11 px-8 font-bold min-w-[130px] shadow-lg shadow-red-100">
                                                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save User"}
                                                </Button>
                                            </div>
                                        </form>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>

                        {/* Search + stat */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <Card className="md:col-span-3 rounded-[2rem] border-none shadow-sm overflow-hidden bg-white">
                                <div className="p-2 flex items-center">
                                    <div className="pl-5 text-gray-400"><Search size={22} /></div>
                                    <Input
                                        placeholder="Search by name, email, ID, or department..."
                                        className="border-none focus-visible:ring-0 text-base h-14 rounded-none bg-transparent"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </Card>
                            <Card className="rounded-[2rem] border-none shadow-sm bg-white p-6 flex items-center justify-center gap-5">
                                <div className="w-14 h-14 rounded-2xl bg-[#FEF0F0] flex items-center justify-center text-[#CC1318]">
                                    <UsersIcon size={28} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-3xl font-black text-gray-900">{users.length}</span>
                                    <span className="text-[11px] uppercase tracking-[0.15em] font-black text-gray-400">System Users</span>
                                </div>
                            </Card>
                        </div>

                        {/* Table */}
                        <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
                            <Table>
                                <TableHeader className="bg-gray-50/50">
                                    <TableRow className="border-gray-100 hover:bg-transparent">
                                        <TableHead className="w-[300px] font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6 pl-10">User Details</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Role & ID</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Department</TableHead>
                                        <TableHead className="font-black text-gray-400 uppercase text-[11px] tracking-[0.2em] py-6">Status</TableHead>
                                        <TableHead className="w-[100px] text-right pr-10" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-12 h-12 border-4 border-gray-100 border-t-[#CC1318] rounded-full animate-spin" />
                                                    <p className="text-sm text-gray-400 font-bold uppercase tracking-widest">Fetching users...</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredUsers.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-80 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <div className="w-20 h-20 rounded-[2.5rem] bg-gray-50 flex items-center justify-center text-gray-200">
                                                        <Search size={40} />
                                                    </div>
                                                    <div>
                                                        <p className="text-lg font-bold text-gray-400">No results found</p>
                                                        <p className="text-xs text-gray-400 mt-1">No users matching "{searchQuery}"</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredUsers.map((user) => (
                                            <TableRow key={user._id} className="border-gray-50 hover:bg-gray-50/30 transition-all group">
                                                <TableCell className="pl-10 py-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-500 font-black uppercase text-lg shadow-inner group-hover:bg-white group-hover:shadow-md transition-all">
                                                            {user.Firstname[0]}{user.Lastname[0]}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="font-bold text-gray-900 group-hover:text-[#CC1318] transition-colors truncate">{user.Firstname} {user.Lastname}</span>
                                                            <span className="text-[11px] text-gray-400 font-medium truncate">{user.Email}</span>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1.5">
                                                        <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-[#CC1318]" />
                                                            {user.Role}
                                                        </div>
                                                        <span className="text-[10px] text-gray-400 font-black uppercase tracking-wider ml-3.5">ID: {user.ReferenceID}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                                                            <Building2 size={14} className="text-gray-300" />
                                                            {user.Department}
                                                        </div>
                                                        {user.Company && (
                                                            <span className="text-[10px] text-gray-400 uppercase tracking-tight ml-[22px] italic">{user.Company}</span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        className={`rounded-full px-4 py-1 text-[10px] font-black uppercase tracking-widest ${user.Status === "Active"
                                                            ? "bg-green-50 text-green-600 hover:bg-green-100 border-green-100"
                                                            : "bg-red-50 text-red-600 hover:bg-red-100 border-red-100"
                                                        }`}
                                                        variant="outline"
                                                    >
                                                        {user.Status === "Active"
                                                            ? <CheckCircle2 size={10} className="mr-1.5" />
                                                            : <XCircle size={10} className="mr-1.5" />}
                                                        {user.Status}
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
                                                            <DropdownMenuItem
                                                                onClick={() => handleToggleAccess(user)}
                                                                className={`gap-3 px-4 py-3 cursor-pointer rounded-xl font-bold text-sm transition-colors ${user.Status === "Active" ? "text-orange-600 focus:bg-orange-50" : "text-green-600 focus:bg-green-50"}`}
                                                            >
                                                                <ShieldCheck size={16} />
                                                                {user.Status === "Active" ? "Revoke System Access" : "Grant System Access"}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="my-1 bg-gray-50" />
                                                            <DropdownMenuItem onClick={() => openEditDialog(user)} className="gap-3 px-4 py-3 cursor-pointer rounded-xl font-bold text-sm focus:bg-[#FEF0F0] focus:text-[#CC1318] transition-colors">
                                                                <Pencil size={16} />
                                                                Modify User & Permissions
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="my-1 bg-gray-50" />
                                                            <DropdownMenuItem onClick={() => { setSelectedUser(user); setIsDeleteDialogOpen(true); }} className="gap-3 px-4 py-3 cursor-pointer rounded-xl font-bold text-sm text-red-600 focus:bg-red-50 focus:text-red-700 transition-colors">
                                                                <Trash2 size={16} />
                                                                Remove User
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
                <Dialog open={isEditDialogOpen} onOpenChange={(o) => { setIsEditDialogOpen(o); if (!o) resetForm(); }}>
                    <DialogContent className={dialogContentClass}>
                        <form onSubmit={handleEditUser} className="flex flex-col flex-1 min-h-0">
                            <div className="p-6 pb-0 flex-shrink-0">
                                <DialogHeader>
                                    <DialogTitle className="text-xl font-bold text-gray-900">Modify User Profile</DialogTitle>
                                    <DialogDescription className="text-gray-500 text-sm">
                                        Update information for {selectedUser?.Firstname} {selectedUser?.Lastname}.
                                    </DialogDescription>
                                </DialogHeader>
                            </div>
                            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
                                <UserFormFields
                                    formData={formData}
                                    onInput={handleInputChange}
                                    onSelect={handleSelectChange}
                                    onPermission={handlePermissionChange}
                                    isEdit
                                />
                            </div>
                            <div className="flex-shrink-0 bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t">
                                <Button type="button" variant="ghost" onClick={() => setIsEditDialogOpen(false)} className="rounded-xl h-11 px-6 font-semibold">Cancel</Button>
                                <Button type="submit" disabled={submitting} className="bg-[#CC1318] hover:bg-[#A8100F] text-white rounded-xl h-11 px-8 font-bold min-w-[130px] shadow-lg shadow-red-100">
                                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update User"}
                                </Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>

                {/* Delete Dialog */}
                <Dialog open={isDeleteDialogOpen} onOpenChange={(o) => { setIsDeleteDialogOpen(o); if (!o) setSelectedUser(null); }}>
                    <DialogContent className="sm:max-w-[420px] rounded-[2.5rem] border-none shadow-2xl p-8">
                        <div className="flex flex-col items-center text-center gap-6">
                            <div className="w-20 h-20 rounded-[2.5rem] bg-red-50 flex items-center justify-center text-red-600">
                                <Trash2 size={40} />
                            </div>
                            <div className="flex flex-col gap-2">
                                <DialogHeader>
                                    <DialogTitle className="text-xl font-bold text-gray-900 text-center">Confirm Deletion</DialogTitle>
                                    <DialogDescription className="text-gray-500 text-center">
                                        Are you sure you want to remove <span className="font-black text-gray-900">{selectedUser?.Firstname} {selectedUser?.Lastname}</span>? This action is permanent.
                                    </DialogDescription>
                                </DialogHeader>
                            </div>
                            <div className="flex w-full gap-3 pt-2">
                                <Button type="button" variant="ghost" onClick={() => setIsDeleteDialogOpen(false)} className="flex-1 rounded-2xl h-12 font-bold">Cancel</Button>
                                <Button type="button" onClick={handleDeleteUser} disabled={submitting} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-2xl h-12 font-bold shadow-lg shadow-red-100">
                                    {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Delete Account"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </ProtectedPageWrapper>
    );
}