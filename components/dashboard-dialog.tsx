"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Calendar, Clock, FileText, Building2, ArrowLeft, LogIn, LogOut, Navigation, Camera, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { MintButton, MintDrawer, MintPill } from "@/components/mint";

interface ActivityLog {
  ReferenceID: string;
  Type: string;
  Status: string;
  Location: string;
  PhotoURL?: string;
  date_created: string;
  Remarks: string;
  SiteVisitAccount: string | null;
  _id?: string;
  Latitude?: number | null;
  Longitude?: number | null;
}

// Cache for reverse geocoding results
const addressCache = new Map<string, string>();

// Check if location is in coordinate format (lat, lng)
function isCoordinateFormat(location: string): boolean {
  if (!location) return false;
  // Pattern: "14.12345, 121.12345" or similar coordinate formats
  const coordPattern = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/;
  return coordPattern.test(location.trim());
}

// Reverse geocode coordinates to address
async function reverseGeocode(coords: string): Promise<string | null> {
  if (addressCache.has(coords)) {
    return addressCache.get(coords)!;
  }
  
  try {
    const [lat, lon] = coords.split(',').map(s => parseFloat(s.trim()));
    if (isNaN(lat) || isNaN(lon)) return null;
    
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { 'Accept-Language': 'en' } }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const address = data.display_name || null;
    
    if (address) {
      addressCache.set(coords, address);
    }
    return address;
  } catch {
    return null;
  }
}

interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
}

interface ActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEvent: ActivityLog | null;
  usersMap: Record<string, UserInfo>;
}

export default function ActivityDialog({ open, onOpenChange, selectedEvent, usersMap }: ActivityDialogProps) {
  const user = selectedEvent ? usersMap[selectedEvent.ReferenceID] : null;
  const fullName = user ? `${user.Firstname} ${user.Lastname}` : "Unknown User";
  const initials = user ? `${user.Firstname[0]}${user.Lastname[0]}` : "?";

  const isLogin = selectedEvent?.Status === "Login";
  const isLogout = selectedEvent?.Status === "Logout";

  // Watermarked-download badge colours — Login mint, Logout clay (GPS/site visit)
  const statusColor = isLogin ? "#0B7F5A" : isLogout ? "#B45C38" : "#64748B";
  const statusBg = isLogin ? "#E6F4EE" : isLogout ? "#FFF1E6" : "#F7FCF9";

  // State for resolved address (reverse geocoding)
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Reverse geocode coordinates when dialog opens
  useEffect(() => {
    if (!open || !selectedEvent) {
      setResolvedAddress(null);
      return;
    }

    // First check if we have Latitude and Longitude to use
    let coordString: string | null = null;
    
    // Convert to numbers if they are strings
    const latNum = typeof selectedEvent.Latitude === 'string' ? parseFloat(selectedEvent.Latitude) : selectedEvent.Latitude;
    const lngNum = typeof selectedEvent.Longitude === 'string' ? parseFloat(selectedEvent.Longitude) : selectedEvent.Longitude;
    
    if (latNum !== null && latNum !== undefined && !isNaN(latNum) && lngNum !== null && lngNum !== undefined && !isNaN(lngNum)) {
      coordString = `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    } else if (selectedEvent.Location) {
      coordString = selectedEvent.Location;
    }

    if (!coordString) {
      setResolvedAddress(null);
      return;
    }
    
    // If it's already an address (not coordinates), use it directly
    if (!isCoordinateFormat(coordString)) {
      setResolvedAddress(null);
      return;
    }

    // If we have it cached, use it
    if (addressCache.has(coordString)) {
      setResolvedAddress(addressCache.get(coordString)!);
      return;
    }

    // Try to reverse geocode if online
    if (navigator.onLine) {
      setIsResolving(true);
      reverseGeocode(coordString)
        .then(address => {
          if (address) {
            setResolvedAddress(address);
          }
        })
        .finally(() => setIsResolving(false));
    }
  }, [open, selectedEvent?.Location, selectedEvent?.Latitude, selectedEvent?.Longitude]);

  // Get display location (resolved address or original)
  const getCoordString = () => {
    if (!selectedEvent) return null;
    
    // Convert to numbers if they are strings
    const latNum = typeof selectedEvent.Latitude === 'string' ? parseFloat(selectedEvent.Latitude) : selectedEvent.Latitude;
    const lngNum = typeof selectedEvent.Longitude === 'string' ? parseFloat(selectedEvent.Longitude) : selectedEvent.Longitude;
    
    if (latNum !== null && latNum !== undefined && !isNaN(latNum) && lngNum !== null && lngNum !== undefined && !isNaN(lngNum)) {
      return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    }
    return selectedEvent.Location;
  };
  const coordString = getCoordString();
  const displayLocation = resolvedAddress || selectedEvent?.Location || "No location recorded";
  const isCoords = coordString ? isCoordinateFormat(coordString) : false;

  // State for download loading
  const [isDownloading, setIsDownloading] = useState(false);

  // Download photo with watermark
  const downloadPhoto = useCallback(async () => {
    if (!selectedEvent?.PhotoURL) return;

    setIsDownloading(true);
    try {
      // Load the image
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = selectedEvent.PhotoURL!;
      });

      // Create canvas
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get canvas context");

      // Set canvas dimensions to match image
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw the original image
      ctx.drawImage(img, 0, 0);

      // Watermark configuration - smaller and professional
      const padding = Math.max(10, canvas.width * 0.015);
      const maxAvailableWidth = canvas.width - (padding * 2);
      const fontSize = Math.max(10, Math.min(canvas.width / 35, 14));
      const lineHeight = fontSize * 1.25;
      
      // Prepare text lines
      const timeText = new Date(selectedEvent.date_created).toLocaleTimeString("en-PH", { 
        hour: "2-digit", 
        minute: "2-digit", 
        hour12: true 
      });
      const statusTimeText = `${selectedEvent.Status} Â· ${timeText}`;
      
      // Truncate location if too long (max 2 lines worth)
      let locationText = displayLocation;
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      
      // Word wrap function for location - with strict max width
      const wrapText = (text: string, maxW: number): string[] => {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxW - 4 && currentLine) {
            lines.push(currentLine);
            currentLine = word;
            // Stop after 2 lines
            if (lines.length >= 2) break;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine && lines.length < 2) lines.push(currentLine);
        
        // Add ellipsis to last line if text was truncated
        if (lines.length === 2 && words.length > lines.join(' ').split(' ').length) {
          const lastLine = lines[1];
          if (lastLine.length > 5) {
            lines[1] = lastLine.substring(0, lastLine.length - 3).trim() + '...';
          }
        }
        return lines;
      };
      
      const locationLines = wrapText(locationText, maxAvailableWidth);

      // Calculate watermark dimensions based on actual wrapped text widths
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      const allLines = [...locationLines, statusTimeText];
      let actualMaxWidth = 0;
      for (const line of allLines) {
        const width = ctx.measureText(line).width;
        if (width > actualMaxWidth) actualMaxWidth = width;
      }
      
      // Strictly constrain watermark within image
      const boxPadding = 10;
      const watermarkWidth = Math.min(actualMaxWidth + (boxPadding * 2), maxAvailableWidth - 4);
      const watermarkHeight = (allLines.length * lineHeight) + (boxPadding * 1.5);
      const startX = padding + boxPadding;
      const startY = canvas.height - padding - watermarkHeight + boxPadding + fontSize;

      // Draw elegant background with rounded corners
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.beginPath();
      const cornerRadius = 5;
      const x = padding;
      const y = canvas.height - padding - watermarkHeight;
      const w = watermarkWidth;
      const h = watermarkHeight;
      
      ctx.moveTo(x + cornerRadius, y);
      ctx.lineTo(x + w - cornerRadius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + cornerRadius);
      ctx.lineTo(x + w, y + h - cornerRadius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - cornerRadius, y + h);
      ctx.lineTo(x + cornerRadius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - cornerRadius);
      ctx.lineTo(x, y + cornerRadius);
      ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
      ctx.closePath();
      ctx.fill();

      // Draw watermark text
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;

      // Draw location lines
      locationLines.forEach((line, index) => {
        ctx.fillText(line, startX, startY + (index * lineHeight));
      });

      // Draw status and time with subtle accent color
      ctx.fillStyle = "rgba(255, 200, 200, 0.9)";
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(statusTimeText, startX, startY + (locationLines.length * lineHeight));

      // Draw Biolog footer watermark at bottom right (very small)
      const footerFontSize = Math.max(8, Math.min(canvas.width / 45, 10));
      const footerText = `Biolog Â· ${new Date().getFullYear()}`;
      ctx.font = `600 ${footerFontSize}px system-ui, -apple-system, sans-serif`;
      const footerMetrics = ctx.measureText(footerText);
      const footerX = canvas.width - padding - footerMetrics.width;
      const footerY = canvas.height - padding - 2;
      
      // Subtle shadow for readability
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillText(footerText, footerX + 1, footerY + 1);
      // White text
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillText(footerText, footerX, footerY);

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("Failed to create image");
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date(selectedEvent.date_created).toISOString().split('T')[0];
        link.href = url;
        link.download = `attendance-${selectedEvent.Status.toLowerCase()}-${dateStr}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success("Photo downloaded with watermark");
      }, "image/png");
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to download photo");
    } finally {
      setIsDownloading(false);
    }
  }, [selectedEvent, displayLocation]);
  /* ── Render: bottom drawer (not a centred dialog) ── */
  // All attributes must precede the `>` that opens the children — JSX does not
  // allow attributes once children start.
  return (
    <MintDrawer
      open={open}
      onOpenChange={onOpenChange}
      onClose={() => onOpenChange(false)}
      title="Event Details"
      description="Activity log entry"
      maxHeight="88vh"
      header={
        <>
          <div
            className="px-5 pt-2 pb-6 flex-shrink-0"
            style={{
              background:
                "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)",
            }}
          >
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
              >
                <ArrowLeft size={17} />
              </button>
              <div className="min-w-0">
                <h2 className="text-[17px] font-black text-[var(--text)] leading-tight">
                  Event Details
                </h2>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)]">
                  Activity log entry
                </p>
              </div>
            </div>

            {/* Who + what */}
            <div
              className="rounded-[var(--r-card)] px-4 py-3 flex items-center gap-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              {user?.profilePicture ? (
                <img
                  src={user.profilePicture}
                  alt={fullName}
                  className="w-11 h-11 rounded-full object-cover"
                />
              ) : (
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white font-black text-sm"
                  style={{ background: "var(--mint-btn)" }}
                >
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-extrabold text-[var(--text)] truncate">
                  {fullName}
                </p>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)]">
                  {selectedEvent?.Type || "Unknown type"}
                </p>
              </div>
              {selectedEvent && (
                <MintPill tone={isLogin ? "mint" : "clay"}>
                  {isLogin ? <LogIn size={11} /> : <LogOut size={11} />}
                  {selectedEvent.Status}
                </MintPill>
              )}
            </div>
          </div>
        </>
      }
      footer={
        selectedEvent ? (
          <div
            className="px-5 pt-3.5 pb-4 shrink-0"
            style={{
              background: "var(--card)",
              borderTop: "1px solid var(--border)",
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <MintButton full size="lg" onClick={() => onOpenChange(false)}>
              Close
            </MintButton>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 p-5" style={{ background: "var(--bg)" }}>
        {selectedEvent ? (
          <>
            {selectedEvent.SiteVisitAccount && (
              <DetailRow
                icon={<Building2 size={15} />}
                tone="clay"
                label="Site Visit"
              >
                {selectedEvent.SiteVisitAccount}
              </DetailRow>
            )}

            {/* Date + time */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-[var(--r-card)] px-3.5 py-3 flex items-start gap-2.5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div
                  className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
                  style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                >
                  <Calendar size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-faint)]">
                    Date
                  </p>
                  <p className="mint-num text-[12.5px] font-extrabold text-[var(--text)] mt-0.5">
                    {new Date(selectedEvent.date_created).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <div
                className="rounded-[var(--r-card)] px-3.5 py-3 flex items-start gap-2.5"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div
                  className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
                  style={{ background: "var(--info-soft)", color: "var(--info)" }}
                >
                  <Clock size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-faint)]">
                    Time
                  </p>
                  <p className="mint-num text-[12.5px] font-extrabold text-[var(--text)] mt-0.5">
                    {new Date(selectedEvent.date_created).toLocaleTimeString("en-PH", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </p>
                </div>
              </div>
            </div>

            {/* Location */}
            <div
              className="rounded-[var(--r-card)] px-4 py-3 flex items-start gap-3"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div
                className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
                style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
              >
                <Navigation size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-faint)] flex items-center gap-1.5">
                  Location
                  {isCoords && !resolvedAddress && !isResolving && (
                    <MintPill tone="clay" className="!text-[9px] !py-0.5 !px-1.5">
                      Offline
                    </MintPill>
                  )}
                </p>
                {isResolving ? (
                  <div className="flex items-center gap-2 text-[var(--text-muted)] mt-1">
                    <Loader2 size={12} className="animate-spin" />
                    <span className="text-[12px] font-semibold">Resolving address…</span>
                  </div>
                ) : (
                  <p className="text-[12.5px] font-bold text-[var(--text)] mt-1 leading-relaxed">
                    {displayLocation}
                  </p>
                )}
                {isCoords && resolvedAddress && (
                  <p className="mint-num text-[10.5px] font-semibold text-[var(--text-faint)] mt-1">
                    Coordinates: {selectedEvent.Location}
                  </p>
                )}
              </div>
            </div>

            {/* Photo */}
            {selectedEvent.PhotoURL && (
              <div
                className="rounded-[var(--r-card)] p-1 flex flex-col"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div
                  className="flex items-center justify-between px-3 py-2.5"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-2">
                    <Camera size={13} style={{ color: "var(--mint)" }} />
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-faint)]">
                      Photo Verification
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={downloadPhoto}
                    disabled={isDownloading}
                    className="mint-tap inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-full text-[11px] font-extrabold text-white disabled:opacity-50"
                    style={{ background: "var(--mint-btn)" }}
                  >
                    {isDownloading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    {isDownloading ? "Saving…" : "Download"}
                  </button>
                </div>
                <div className="relative aspect-[4/3] rounded-[14px] overflow-hidden mt-1.5">
                  <img
                    src={selectedEvent.PhotoURL}
                    alt="Attendance verification"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            )}

            {/* Remarks */}
            {selectedEvent.Remarks && (
              <div
                className="rounded-[var(--r-card)] px-4 py-3 flex items-start gap-3"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div
                  className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
                  style={{ background: "var(--bg)", color: "var(--text-faint)" }}
                >
                  <FileText size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-faint)]">
                    Remarks
                  </p>
                  <p className="text-[12.5px] font-semibold text-[var(--text)] mt-0.5 leading-relaxed">
                    {selectedEvent.Remarks}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center text-center py-10">
            <div
              className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-3"
              style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
            >
              <FileText size={24} />
            </div>
            <p className="text-[14px] font-extrabold text-[var(--text)]">
              No event selected
            </p>
            <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-1">
              Pick an entry from the calendar to see its full details.
            </p>
          </div>
        )}
      </div>
    </MintDrawer>
  );
}

function DetailRow({
  icon,
  label,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "clay" | "mint" | "info";
  children: React.ReactNode;
}) {
  const map = {
    clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
  }[tone];

  return (
    <div
      className="rounded-[var(--r-card)] px-4 py-3 flex items-start gap-3"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div
        className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
        style={{ background: map.bg, color: map.fg }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-faint)]">
          {label}
        </p>
        <p className="text-[13px] font-extrabold text-[var(--text)] mt-0.5">{children}</p>
      </div>
    </div>
  );
}