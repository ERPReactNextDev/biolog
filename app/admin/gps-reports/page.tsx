"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UserProvider, useUser } from "@/contexts/UserContext";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { toast } from "sonner";
import {
  MapPin,
  ChevronLeft,
  Search,
  Filter,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Clock,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";

interface GPSReport {
  _id: string;
  ReferenceID: string;
  Email: string;
  TSM: string;
  Type: string;
  Status: string;
  Remarks: string;
  PhotoURL: string[];
  loginDate: string;
  logoutDate: string;
  Latitude: number;
  Longitude: number;
  Location: string;
  reviewStatus: string;
  date_created: string;
}

interface UserDetails {
  Firstname: string;
  Lastname: string;
  Email: string;
  Role: string;
  Department: string;
  ReferenceID: string;
}

function GPSReportsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { userId } = useUser();
  const queryUserId = searchParams?.get("id") ?? "";

  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [reports, setReports] = useState<GPSReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [selectedReport, setSelectedReport] = useState<GPSReport | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!queryUserId) {
      toast.error("User ID is missing.");
      return;
    }
    fetchUserDetails();
  }, [queryUserId]);

  useEffect(() => {
    if (userDetails) {
      const authorized = 
        userDetails.Role === "SuperAdmin" || 
        userDetails.Role === "Admin" ||
        userDetails.Department === "Human Resources" ||
        userDetails.Department === "HR Department";
      
      setIsAuthorized(authorized);
      
      if (authorized) {
        fetchReports();
      } else {
        setLoading(false);
        toast.error("You don't have permission to view GPS reports.");
      }
    }
  }, [userDetails]);

  const fetchUserDetails = async () => {
    try {
      const res = await fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`);
      if (!res.ok) throw new Error("Failed to fetch user data");
      const data = await res.json();
      setUserDetails({
        Firstname: data.Firstname ?? "",
        Lastname: data.Lastname ?? "",
        Email: data.Email ?? "",
        Role: data.Role ?? "",
        Department: data.Department ?? "",
        ReferenceID: data.ReferenceID ?? "",
      });
    } catch (err) {
      toast.error("Failed to load user data.");
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/gps-report");
      if (!res.ok) throw new Error("Failed to fetch reports");
      const data = await res.json();
      setReports(data.reports || []);
    } catch (err) {
      toast.error("Failed to load GPS reports.");
    } finally {
      setLoading(false);
    }
  };

  const updateReportStatus = async (reportId: string, newStatus: "approved" | "rejected") => {
    try {
      const res = await fetch("/api/gps-report/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, status: newStatus, reviewedBy: userDetails?.ReferenceID }),
      });

      if (res.ok) {
        toast.success(`Report ${newStatus} successfully!`);
        fetchReports();
        setSelectedReport(null);
      } else {
        throw new Error("Failed to update status");
      }
    } catch (err) {
      toast.error("Failed to update report status.");
    }
  };

  const filteredReports = reports.filter((report) => {
    const matchesSearch = 
      report.ReferenceID.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.Email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.TSM.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.Remarks.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || report.reviewStatus === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const goBack = () => {
    router.push(`/activity-planner?id=${encodeURIComponent(queryUserId)}`);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9F6F4] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#CC1318] rounded-full animate-spin" />
          <p className="text-[12px] text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F9F6F4] flex flex-col">
        <div className="px-5 pt-12 pb-6" style={{ background: "linear-gradient(145deg, var(--brand-primary) 0%, var(--brand-primary-hover) 100%)" }}>
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-white text-[20px] font-semibold">GPS Reports</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-[var(--brand-light)] flex items-center justify-center mx-auto mb-4">
              <XCircle size={32} className="text-[var(--brand-primary)]" />
            </div>
            <h2 className="text-[18px] font-semibold text-gray-800 mb-2">Access Denied</h2>
            <p className="text-[13px] text-gray-500 mb-6">
              Only SuperAdmin, Admin, and HR Department members can view GPS reports.
            </p>
            <button
              onClick={goBack}
              className="w-full py-3 rounded-xl bg-[var(--brand-primary)] text-white font-semibold text-[14px]"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F6F4] flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-6" style={{ background: "linear-gradient(145deg, var(--brand-primary) 0%, var(--brand-primary-hover) 100%)" }}>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={goBack} className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-white text-[20px] font-semibold">GPS Reports</h1>
            <p className="text-white/60 text-[12px]">Review offline attendance submissions</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-3 mt-4">
          <div className="flex-1 bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
            <p className="text-white/60 text-[11px]">Total</p>
            <p className="text-white text-[20px] font-bold">{reports.length}</p>
          </div>
          <div className="flex-1 bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
            <p className="text-white/60 text-[11px]">Pending</p>
            <p className="text-white text-[20px] font-bold">{reports.filter(r => r.reviewStatus === "pending").length}</p>
          </div>
          <div className="flex-1 bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10">
            <p className="text-white/60 text-[11px]">Approved</p>
            <p className="text-white text-[20px] font-bold">{reports.filter(r => r.reviewStatus === "approved").length}</p>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="px-4 py-4 bg-white border-b border-gray-100">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by ID, email, or TSM..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-gray-100 bg-gray-50 pl-10 pr-4 py-2.5 text-[13px] outline-none focus:border-[var(--brand-primary)] transition-all"
            />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {(["all", "pending", "approved", "rejected"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
                statusFilter === status
                  ? "bg-[var(--brand-primary)] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Reports List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        {filteredReports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4">
              <MapPin size={32} className="text-gray-300" />
            </div>
            <p className="text-[14px] text-gray-500">No GPS reports found</p>
            <p className="text-[12px] text-gray-400 mt-1">
              {searchQuery || statusFilter !== "all" ? "Try adjusting your filters" : "Reports will appear here when submitted"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredReports.map((report) => (
              <button
                key={report._id}
                onClick={() => setSelectedReport(report)}
                className="w-full bg-white rounded-2xl border border-gray-100 p-4 text-left hover:border-[var(--brand-primary)]/30 hover:bg-[var(--brand-light)]/20 transition-all active:scale-[0.98]"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      report.reviewStatus === "approved" ? "bg-[#EEF7F2]" :
                      report.reviewStatus === "rejected" ? "bg-[#FEF0F0]" : "bg-[#FDF4E7]"
                    }`}>
                      {report.reviewStatus === "approved" ? <CheckCircle size={18} className="text-[#1A7A4A]" /> :
                       report.reviewStatus === "rejected" ? <XCircle size={18} className="text-[#CC1318]" /> :
                       <Clock size={18} className="text-[#A0611A]" />}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-gray-800">{report.ReferenceID}</p>
                      <p className="text-[11px] text-gray-400">{report.TSM || "No TSM"}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                    report.reviewStatus === "approved" ? "bg-[#EEF7F2] text-[#1A7A4A]" :
                    report.reviewStatus === "rejected" ? "bg-[#FEF0F0] text-[#CC1318]" :
                    "bg-[#FDF4E7] text-[#A0611A]"
                  }`}>
                    {report.reviewStatus}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[12px] text-gray-600">
                    <Calendar size={14} className="text-gray-400" />
                    <span>{formatDate(report.date_created)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-gray-600">
                    <MapPin size={14} className="text-gray-400" />
                    <span className="line-clamp-1">{report.Location || "No location"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-gray-600">
                    <ImageIcon size={14} className="text-gray-400" />
                    <span>{report.PhotoURL?.length || 0} photos</span>
                  </div>
                </div>

                <p className="text-[12px] text-gray-500 mt-3 line-clamp-2 bg-gray-50 rounded-lg p-2">
                  "{report.Remarks}"
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Report Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px]">
            <div className="sticky top-0 bg-white px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-semibold text-gray-800">Report Details</h2>
                <button
                  onClick={() => setSelectedReport(null)}
                  className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-gray-400">Status</span>
                <span className={`px-3 py-1.5 rounded-full text-[12px] font-bold uppercase ${
                  selectedReport.reviewStatus === "approved" ? "bg-[#EEF7F2] text-[#1A7A4A]" :
                  selectedReport.reviewStatus === "rejected" ? "bg-[#FEF0F0] text-[#CC1318]" :
                  "bg-[#FDF4E7] text-[#A0611A]"
                }`}>
                  {selectedReport.reviewStatus}
                </span>
              </div>

              {/* User Info */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <User size={18} className="text-gray-400" />
                  <div>
                    <p className="text-[13px] font-semibold text-gray-800">{selectedReport.ReferenceID}</p>
                    <p className="text-[11px] text-gray-500">{selectedReport.Email}</p>
                  </div>
                </div>
                <p className="text-[12px] text-gray-600">
                  <span className="text-gray-400">TSM:</span> {selectedReport.TSM || "N/A"}
                </p>
              </div>

              {/* Time Period */}
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-gray-800">Time Period</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#EEF7F2] rounded-xl p-3">
                    <p className="text-[10px] text-[#1A7A4A] font-bold uppercase">Login</p>
                    <p className="text-[13px] font-semibold text-gray-800">{formatDateTime(selectedReport.loginDate)}</p>
                  </div>
                  <div className="bg-[#FEF0F0] rounded-xl p-3">
                    <p className="text-[10px] text-[#CC1318] font-bold uppercase">Logout</p>
                    <p className="text-[13px] font-semibold text-gray-800">{formatDateTime(selectedReport.logoutDate)}</p>
                  </div>
                </div>
              </div>

              {/* Location */}
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-gray-800">Location</p>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[12px] text-gray-600">{selectedReport.Location || "No address available"}</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Lat: {selectedReport.Latitude}, Lng: {selectedReport.Longitude}
                  </p>
                  <a
                    href={`https://www.google.com/maps?q=${selectedReport.Latitude},${selectedReport.Longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-[11px] text-[#185FA5] font-medium"
                  >
                    View on Map <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Photos */}
              {selectedReport.PhotoURL && selectedReport.PhotoURL.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-gray-800">Photos ({selectedReport.PhotoURL.length})</p>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedReport.PhotoURL.map((photo, idx) => (
                      <a
                        key={idx}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-xl overflow-hidden border border-gray-100"
                      >
                        <img src={photo} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Remarks */}
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-gray-800">Remarks</p>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-[13px] text-gray-700 leading-relaxed">{selectedReport.Remarks}</p>
                </div>
              </div>

              {/* Action Buttons */}
              {selectedReport.reviewStatus === "pending" && (
                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => updateReportStatus(selectedReport._id, "rejected")}
                    className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-[14px] hover:bg-gray-200 transition-colors"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => updateReportStatus(selectedReport._id, "approved")}
                    className="flex-1 py-3 rounded-xl bg-[#1A7A4A] text-white font-semibold text-[14px] hover:bg-[#156b3d] transition-colors"
                  >
                    Approve
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <GPSReportsPage />
      </UserProvider>
    </ProtectedPageWrapper>
  );
}
