"use client";

import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import { AppSidebar } from "@/components/app-sidebar";

import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";

import { SidebarInset, SidebarProvider, SidebarTrigger, } from "@/components/ui/sidebar";
import { Table, TableCaption, TableHeader, TableRow, TableHead, TableBody, TableCell, } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext, PaginationLink, PaginationEllipsis, } from "@/components/ui/pagination";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner";
import { Search, DownloadCloud } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, } from "@/components/ui/dialog";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { type DateRange } from "react-day-picker";

import ProtectedPageWrapper from "@/components/protected-page-wrapper";

interface ActivityLog {
    ReferenceID: string;
    Email: string;
    Type: string;
    Status: string;
    Location: string;
    date_created: string;
    PhotoURL?: string;
    Remarks: string;
    _id?: string;
}

export default function Page() {
    const searchParams = useSearchParams();
    const { userId, setUserId } = useUser();
    const queryUserId = searchParams?.get("id") ?? "";

    const [userDetails, setUserDetails] = useState({
        UserId: "",
        Firstname: "",
        Lastname: "",
        Email: "",
        Role: "",
        Department: "",
        Company: "",
        ReferenceID: "",
        profilePicture: "",
    });

    const [posts, setPosts] = useState<ActivityLog[]>([]);
    const [usersMap, setUsersMap] = useState<
        Record<string, { Firstname: string; Lastname: string; profilePicture?: string }>
    >({});

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filters and pagination state
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<string | null>(null);
    const [dateCreatedFilterRange, setDateCreatedFilterRange] = useState<DateRange | undefined>(undefined);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingPost, setEditingPost] = useState<null | { _id?: string; Remarks: string }>(null);
    const [remarksInput, setRemarksInput] = useState("");

    // Expanded rows state
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState<{ url?: string; date?: string } | null>(null);

    // Sync userId from query param to context
    useEffect(() => {
        if (queryUserId && queryUserId !== userId) {
            setUserId(queryUserId);
        }
    }, [queryUserId, userId, setUserId]);

    // Fetch logged-in user details
    useEffect(() => {
        const fetchUserData = async () => {
            if (!queryUserId) {
                setError("User ID is missing.");
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
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
                toast.error("Failed to load user data.");
                setError("Failed to load user data.");
            } finally {
                setLoading(false);
            }
        };
        fetchUserData();
    }, [queryUserId]);

    // Fetch activity logs
    useEffect(() => {
        const fetchAllActivityLogs = async () => {
            if (!userDetails) return;
            setLoading(true);

            try {
                let allLogs: ActivityLog[] = [];
                let page = 1;
                const limit = 100;
                let totalPages = 1;

                do {
                    const params = new URLSearchParams();
                    params.append("page", page.toString());
                    params.append("limit", limit.toString());
                    params.append("role", userDetails.Role);

                    if (
                        userDetails.Role !== "SuperAdmin" &&
                        userDetails.Role !== "Human Resources"
                    ) {
                        params.append("referenceID", userDetails.ReferenceID);
                    }

                    if (dateCreatedFilterRange?.from) {
                        params.append("startDate", dateCreatedFilterRange.from.toISOString());
                        params.append(
                            "endDate",
                            (dateCreatedFilterRange.to ?? dateCreatedFilterRange.from).toISOString()
                        );
                    }

                    const res = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
                    if (!res.ok) throw new Error("Failed to fetch logs");

                    const data = await res.json();
                    allLogs = allLogs.concat(data.data ?? []);

                    totalPages = data.pagination?.totalPages ?? 1;
                    page++;
                } while (page <= totalPages);

                setPosts(allLogs);
            } catch (err) {
                toast.error("Error fetching activity logs.");
                setPosts([]);
            } finally {
                setLoading(false);
            }
        };

        fetchAllActivityLogs();
    }, [userDetails, dateCreatedFilterRange]);

    // Fetch user info for ReferenceIDs in posts
    useEffect(() => {
        async function fetchUsersForPosts() {
            if (posts.length === 0) return;

            const uniqueRefs = Array.from(new Set(posts.map((p) => p.ReferenceID)));

            try {
                const res = await fetch(`/api/users?referenceIDs=${uniqueRefs.join(",")}`);
                if (!res.ok) throw new Error("Failed to fetch users");
                const usersData = await res.json();

                const map: Record<string, { Firstname: string; Lastname: string; profilePicture?: string }> = {};
                usersData.forEach((user: any) => {
                    map[user.ReferenceID] = {
                        Firstname: user.Firstname,
                        Lastname: user.Lastname,
                        profilePicture: user.profilePicture,
                    };
                });

                setUsersMap(map);
            } catch (error) {
            }
        }
        fetchUsersForPosts();
    }, [posts]);

    function isDateInRange(dateStr: string, start?: Date, end?: Date) {
        if (!start && !end) return true;

        const date = new Date(dateStr);
        const dateYMD = new Date(date.getFullYear(), date.getMonth(), date.getDate()); // local midnight

        if (start && end) {
            const startYMD = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            const endYMD = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            // inclusive range
            return dateYMD >= startYMD && dateYMD <= endYMD;
        } else if (start) {
            const startYMD = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            return dateYMD.getTime() === startYMD.getTime();
        } else if (end) {
            const endYMD = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            return dateYMD.getTime() === endYMD.getTime();
        }
        return true;
    }

    // Filtering logic
    const filteredByReference = posts.filter((post) => post.ReferenceID === userDetails.ReferenceID);

    const allVisibleAccounts =
        userDetails.Role === "SuperAdmin" || userDetails.Department === "Human Resources"
            ? posts
            : filteredByReference;

    const filteredAccounts = allVisibleAccounts
        .filter((post) => {
            const search = searchQuery.toLowerCase();

            const matchesSearch =
                post.Type?.toLowerCase().includes(search) ||
                post.Status?.toLowerCase().includes(search) ||
                post.Email?.toLowerCase().includes(search) ||
                post.ReferenceID?.toLowerCase().includes(search);

            const matchesType = filterType ? post.Type === filterType : true;

            const matchesDate = isDateInRange(post.date_created, dateCreatedFilterRange?.from, dateCreatedFilterRange?.to);

            return matchesSearch && matchesType && matchesDate;
        })
        .sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());

    // Pagination
    const pageCount = Math.ceil(filteredAccounts.length / itemsPerPage);
    const paginatedAccounts = filteredAccounts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Reset page on filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, filterType, dateCreatedFilterRange]);

    // Edit dialog handlers
    function openEditDialog(post: { _id?: string; Remarks: string }) {
        setEditingPost(post);
        setRemarksInput(post.Remarks);
        setEditDialogOpen(true);
    }

    async function saveUpdate() {
        if (!editingPost?._id) {
            toast.error("Cannot update: Missing record ID");
            return;
        }
        try {
            setLoading(true);
            const res = await fetch(`/api/ModuleSales/Activity/UpdateLog`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _id: editingPost._id, Remarks: remarksInput }),
            });

            if (!res.ok) {
                const errorBody = await res.json();
                throw new Error(errorBody.error || "Failed to update log");
            }

<<<<<<< HEAD
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

  // Fetch activity logs from API
  useEffect(() => {
    const fetchAllActivityLogs = async () => {
      if (!userDetails) return;
      setLoading(true);

      try {
        let allLogs: ActivityLog[] = [];
        let page = 1;
        const limit = 100;
        let totalPages = 1;

        do {
          const params = new URLSearchParams();
          params.append("page", page.toString());
          params.append("limit", limit.toString());
          params.append("role", userDetails.Role);

          if (
            userDetails.Role !== "SuperAdmin" &&
            userDetails.Role !== "Human Resources"
          ) {
            params.append("referenceID", userDetails.ReferenceID);
          }

          if (dateCreatedFilterRange?.from) {
            params.append("startDate", dateCreatedFilterRange.from.toISOString());
            params.append(
              "endDate",
              (dateCreatedFilterRange.to ?? dateCreatedFilterRange.from).toISOString()
=======
            setPosts((prev) =>
                prev.map((p) => (p._id === editingPost._id ? { ...p, Remarks: remarksInput } : p))
>>>>>>> 75fe35959c0c87538b9ee4dec523a7644705e70d
            );

            toast.success("Activity log updated successfully");
            setEditDialogOpen(false);
            setEditingPost(null);
        } catch (error: any) {
            toast.error(error.message || "Failed to update activity log");
        } finally {
            setLoading(false);
        }
    }

    // Badge color helper
    function statusColor(status: string) {
        if (!status) return "default";
        if (status.toLowerCase() === "login") return "green";
        if (status.toLowerCase() === "logout") return "red";
        return "gray";
    }

    // Simulate loading while typing with debounce
    useEffect(() => {
        if (searchQuery === "") {
            setLoading(false);
            return;
        }
        setLoading(true);
        const timeout = setTimeout(() => {
            setLoading(false);
            // Here you could do actual search or API fetch
        }, 1000); // 1 second debounce

<<<<<<< HEAD
        setPosts(allLogs);
      } catch (err) {
        toast.error("Error fetching activity logs.");
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };
=======
        return () => clearTimeout(timeout);
    }, [searchQuery]);
>>>>>>> 75fe35959c0c87538b9ee4dec523a7644705e70d

    async function handleExport() {
        if (!(userDetails.Role === "SuperAdmin" || userDetails.Department === "Human Resources")) {
            toast.error("You do not have permission to export data.");
            return;
        }

        try {
            setLoading(true);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet("Activity Logs");

            // Add header row
            worksheet.addRow([
                "ReferenceID",
                "Email",
                "Type",
                "Status",
                "Location",
                "Date Created",
                "Remarks",
            ]);

            // Add data rows
            filteredAccounts.forEach((log) => {
                worksheet.addRow([
                    log.ReferenceID,
                    log.Email,
                    log.Type,
                    log.Status,
                    log.Location,
                    new Date(log.date_created).toLocaleString(),
                    log.Remarks || "",
                ]);
            });

            // Format header row
            worksheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true };
            });

            // Generate buffer
            const buffer = await workbook.xlsx.writeBuffer();

            // Save file using file-saver
            const blob = new Blob([buffer], {
                type:
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });

            saveAs(blob, `ActivityLogs_${new Date().toISOString().slice(0, 10)}.xlsx`);

            toast.success("Export successful!");
        } catch (error) {
            toast.error("Failed to export data.");
        } finally {
            setLoading(false);
        }
    }

    function openPhotoDialog(post: ActivityLog) {
        setSelectedPhoto({
            url: post.PhotoURL,
            date: post.date_created,
        });
        setPhotoDialogOpen(true);
    }

<<<<<<< HEAD
        setUsersMap(map);
      } catch (err) {
      }
    };
=======
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
                                <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
                                <Breadcrumb>
                                    <BreadcrumbList>
                                        <BreadcrumbItem>
                                            <BreadcrumbPage>Activity Logs</BreadcrumbPage>
                                        </BreadcrumbItem>
                                    </BreadcrumbList>
                                </Breadcrumb>
                            </header>
>>>>>>> 75fe35959c0c87538b9ee4dec523a7644705e70d

                            <div className="flex flex-1 flex-col gap-4 p-4">
                                <div className="flex items-center w-full max-w-md gap-2">
                                    {/* Search input container (relative for icon and spinner) */}
                                    <div className="relative flex-grow">
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                            <Search className="h-5 w-5 text-gray-400" />
                                        </div>

                                        <Input
                                            id="search"
                                            type="text"
                                            placeholder="Search by type, status, email, reference..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-10 pr-10 rounded-md w-full text-xs"
                                        />

                                        {loading && (
                                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                                                <Spinner className="h-5 w-5 text-gray-500" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Export button aligned right */}
                                    {(userDetails.Role === "SuperAdmin" || userDetails.Department === "Human Resources") && (
                                        <Button onClick={handleExport} className="bg-black text-white px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-200">
                                            <DownloadCloud size={18} />  Export Data
                                        </Button>
                                    )}
                                </div>


                                <div className="w-full overflow-x-auto">
                                    {paginatedAccounts.map((post) => {
                                        const user = usersMap[post.ReferenceID];
                                        const createdDate = new Date(post.date_created);
                                        const formattedDate = createdDate.toLocaleDateString();
                                        const formattedTime = createdDate.toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        });

                                        return (
                                            <Item
                                                key={post._id || post.ReferenceID}
                                                variant="outline"
                                                className="mb-4"
                                            >
                                                <ItemContent>
                                                    <ItemTitle className="flex items-center gap-2">
                                                        {/* Photo */}
                                                        {post.PhotoURL ? (
                                                            <img
                                                                src={post.PhotoURL}
                                                                alt="Photo"
                                                                className="h-20 w-20 rounded-md object-cover"
                                                            />
                                                        ) : (
                                                            <div className="h-20 w-20 rounded-md bg-gray-300 flex items-center justify-center text-xs text-gray-600">
                                                                N/A
                                                            </div>
                                                        )}

                                                        {/* User Name and ReferenceID */}
                                                        <div>
                                                            <div className="font-semibold">
                                                                {user ? `${user.Firstname} ${user.Lastname}` : "Unknown User"}
                                                            </div>
                                                            <div className="text-[10px] text-gray-500">{post.ReferenceID}</div>
                                                            <div className="text-[10px] text-gray-500"><strong>Type:</strong> {post.Type}</div>
                                                            <div className="text-[10px] text-gray-500">
                                                                <strong>Status:</strong>{" "}
                                                                <Badge variant="outline" className="text-[8px]" color={statusColor(post.Status)}>
                                                                    {post.Status}
                                                                </Badge>
                                                            </div>
                                                            <div className="text-[10px] text-gray-500"><strong>Date:</strong> {formattedDate} {formattedTime}</div>
                                                            <div className="text-[10px] text-gray-500"><strong>Location:</strong> {post.Location || "N/A"}</div>
                                                        </div>
                                                    </ItemTitle>
                                                </ItemContent>

                                                <ItemActions>
                                                    <Button
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            openEditDialog(post);
                                                        }}
                                                    >
                                                        Edit
                                                    </Button>

                                                    {post.PhotoURL && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                openPhotoDialog(post);
                                                            }}
                                                        >
                                                            View Photo
                                                        </Button>
                                                    )}
                                                </ItemActions>
                                            </Item>
                                        );
                                    })}
                                </div>
                                {/* Pagination */}
                                {pageCount > 1 && (
                                    <Pagination className="mt-4 flex justify-center">
                                        <PaginationContent>
                                            <PaginationItem>
                                                <PaginationPrevious
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (currentPage === 1) return;
                                                        setCurrentPage((p) => Math.max(p - 1, 1));
                                                    }}
                                                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                                                />
                                            </PaginationItem>

                                            <PaginationItem>
                                                <PaginationLink
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        setCurrentPage(1);
                                                    }}
                                                    aria-current={currentPage === 1 ? "page" : undefined}
                                                    className={currentPage === 1 ? "font-bold underline" : ""}
                                                >
                                                    1
                                                </PaginationLink>
                                            </PaginationItem>

                                            {currentPage > 3 && (
                                                <PaginationItem>
                                                    <PaginationEllipsis />
                                                </PaginationItem>
                                            )}

                                            {Array.from(
                                                { length: Math.min(pageCount - 2, 3) },
                                                (_, i) => i + Math.max(2, currentPage - 1)
                                            )
                                                .filter((page) => page < pageCount)
                                                .map((page) => (
                                                    <PaginationItem key={page}>
                                                        <PaginationLink
                                                            href="#"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                setCurrentPage(page);
                                                            }}
                                                            aria-current={currentPage === page ? "page" : undefined}
                                                            className={currentPage === page ? "font-bold underline" : ""}
                                                        >
                                                            {page}
                                                        </PaginationLink>
                                                    </PaginationItem>
                                                ))}

                                            {currentPage < pageCount - 2 && (
                                                <PaginationItem>
                                                    <PaginationEllipsis />
                                                </PaginationItem>
                                            )}

                                            {pageCount > 1 && (
                                                <PaginationItem>
                                                    <PaginationLink
                                                        href="#"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            setCurrentPage(pageCount);
                                                        }}
                                                        aria-current={currentPage === pageCount ? "page" : undefined}
                                                        className={currentPage === pageCount ? "font-bold underline" : ""}
                                                    >
                                                        {pageCount}
                                                    </PaginationLink>
                                                </PaginationItem>
                                            )}

                                            <PaginationItem>
                                                <PaginationNext
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (currentPage === pageCount) return;
                                                        setCurrentPage((p) => Math.min(p + 1, pageCount));
                                                    }}
                                                    className={currentPage === pageCount ? "pointer-events-none opacity-50" : ""}
                                                />
                                            </PaginationItem>
                                        </PaginationContent>
                                    </Pagination>
                                )}

                                {/* Edit Dialog */}
                                <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Edit Remarks</DialogTitle>
                                        </DialogHeader>
                                        <textarea
                                            className="w-full rounded border p-2"
                                            rows={5}
                                            value={remarksInput}
                                            onChange={(e) => setRemarksInput(e.target.value)}
                                        />
                                        <DialogFooter className="flex justify-end gap-2">
                                            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                                                Cancel
                                            </Button>
                                            <Button onClick={saveUpdate} disabled={loading}>
                                                {loading ? "Saving..." : "Save"}
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>

                                {/* Photo Dialog */}
                                {/* Photo Dialog */}
                                <Dialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen}>
                                    <DialogContent className="max-w-sm">
                                        <DialogHeader>
                                            <DialogTitle>Photo Viewer</DialogTitle>
                                        </DialogHeader>

                                        {selectedPhoto?.url ? (
                                            <div className="flex flex-col items-center gap-2">
                                                <img
                                                    src={selectedPhoto.url}
                                                    alt="Activity Photo"
                                                    className="w-full rounded-md object-contain"
                                                />
                                                <div className="text-sm text-white bg-black p-2 rounded">
                                                    Date: {new Date(selectedPhoto.date || "").toLocaleString()}
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-500">No photo available.</p>
                                        )}

                                        <DialogFooter className="flex justify-end mt-4 gap-2">
                                            <Button variant="outline" onClick={() => setPhotoDialogOpen(false)}>
                                                Close
                                            </Button>

                                            {selectedPhoto?.url && (
                                                <Button
                                                    onClick={async () => {
                                                        try {
                                                            const res = await fetch(selectedPhoto.url!);
                                                            const blob = await res.blob();
                                                            const url = window.URL.createObjectURL(blob);
                                                            const a = document.createElement("a");
                                                            a.href = url;
                                                            a.download = `ActivityPhoto_${new Date(selectedPhoto.date || "").toISOString()}.jpg`;
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            a.remove();
                                                            window.URL.revokeObjectURL(url);
                                                        } catch (err) {
                                                            toast.error("Failed to download photo.");
                                                        }
                                                    }}
                                                >
                                                    <DownloadCloud /> Download Photo
                                                </Button>
                                            )}
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>

                            </div>
                        </SidebarInset>
                    </SidebarProvider>
                </FormatProvider>
            </UserProvider>
        </ProtectedPageWrapper>
    );
}
