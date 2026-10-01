import React, { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Laptop, Wifi, Mail, AlertCircle } from "lucide-react";

interface TicketDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  editingId?: string | null;
  form: Record<string, any>;
  handleInputChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => void;
  handleSelectChange: (name: string, value: string) => void;
  handleSubmit: () => void;
  handleUpdate: () => void;
  resetForm: () => void;
  fullname: string;
  department: string;
  existingTicketIds: string[];
}

function generateTicketID(existingTicketIds: string[]): string {
  const prefix = "DSI";

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const datePart = `${year}-${month}-${day}`;

  const todayIds = existingTicketIds.filter((id) =>
    id.startsWith(`${prefix}-${datePart}`)
  );

  let maxSeq = 0;
  for (const id of todayIds) {
    const parts = id.split("-");
    const seqStr = parts[4];
    const seqNum = parseInt(seqStr, 10);
    if (!isNaN(seqNum) && seqNum > maxSeq) {
      maxSeq = seqNum;
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(3, "0");

  return `${prefix}-${datePart}-${nextSeq}`;
}

const commonIssues = [
  {
    icon: <Laptop className="w-5 h-5 text-blue-600" />,
    text: "Computer won't turn on or is running slow",
  },
  {
    icon: <Wifi className="w-5 h-5 text-[var(--mint)]" />,
    text: "Network connectivity problems or slow internet",
  },
  {
    icon: <Mail className="w-5 h-5 text-[var(--info)]" />,
    text: "Email issues: can't send or receive emails",
  },
  {
    icon: <AlertCircle className="w-5 h-5 text-[var(--alert)]" />,
    text: "Software errors or unexpected crashes",
  },
  {
    icon: <Laptop className="w-5 h-5 text-[var(--info)]" />,
    text: "Laptop battery drains quickly or not charging",
  },
  {
    icon: <Wifi className="w-5 h-5 text-[var(--mint)]" />,
    text: "WiFi disconnects frequently",
  },
  {
    icon: <Mail className="w-5 h-5 text-[var(--clay)]" />,
    text: "Email password reset or account locked",
  },
  {
    icon: <AlertCircle className="w-5 h-5 text-[var(--clay)]" />,
    text: "Application installation or update failures",
  },
  {
    icon: <Laptop className="w-5 h-5 text-cyan-600" />,
    text: "Peripheral devices (printer, scanner) not working",
  },
  {
    icon: <Wifi className="w-5 h-5 text-lime-600" />,
    text: "VPN connection issues",
  },
  {
    icon: <Mail className="w-5 h-5 text-fuchsia-600" />,
    text: "Spam or phishing emails received",
  },
  {
    icon: <AlertCircle className="w-5 h-5 text-rose-600" />,
    text: "Computer freezes or crashes unexpectedly",
  },
  {
    icon: <Laptop className="w-5 h-5 text-violet-600" />,
    text: "Slow system performance or lagging",
  },
  {
    icon: <Wifi className="w-5 h-5 text-sky-600" />,
    text: "Unable to access shared network drives",
  },
  {
    icon: <Mail className="w-5 h-5 text-emerald-600" />,
    text: "Email signature or formatting issues",
  },
  {
    icon: <AlertCircle className="w-5 h-5 text-yellow-600" />,
    text: "Security alerts or suspected malware infections",
  },
  {
    icon: <Laptop className="w-5 h-5 text-cyan-700" />,
    text: "Operating system errors or update problems",
  },
  {
    icon: <Wifi className="w-5 h-5 text-green-700" />,
    text: "Slow or unresponsive web browsing",
  },
  {
    icon: <Mail className="w-5 h-5 text-purple-700" />,
    text: "Email not syncing on mobile devices",
  },
  {
    icon: <AlertCircle className="w-5 h-5 text-[var(--alert-ink)]" />,
    text: "Forgotten login credentials for applications",
  },
];

// Helper to chunk array into groups of N items
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export const ReceivedDialog: React.FC<TicketDialogProps> = ({
  open,
  setOpen,
  editingId,
  form,
  handleInputChange,
  handleSelectChange,
  handleSubmit,
  handleUpdate,
  resetForm,
  fullname,
  department,
  existingTicketIds,
}) => {
  const initializedRef = useRef(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const issueChunks = chunkArray(commonIssues, 4);

  // Auto-slide effect every 5 seconds
  useEffect(() => {
    if (!open) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % issueChunks.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [open, issueChunks.length]);

  useEffect(() => {
    if (open && !editingId && !initializedRef.current) {
      // Generate new ticket ID
      const newTicketId = generateTicketID(existingTicketIds);
      handleInputChange({
        target: { name: "ticket_id", value: newTicketId },
      } as React.ChangeEvent<HTMLInputElement>);

      // Set requestor_name if empty
      if (!form.requestor_name) {
        handleInputChange({
          target: { name: "requestor_name", value: fullname },
        } as React.ChangeEvent<HTMLInputElement>);
      }

      if (!form.department) {
        handleInputChange({
          target: { name: "department", value: department },
        } as React.ChangeEvent<HTMLInputElement>);
      }

      // Fix mode to "Acculog"
      handleInputChange({
        target: { name: "mode", value: "Acculog" },
      } as React.ChangeEvent<HTMLInputElement>);

      // Fix status to "Pending"
      handleSelectChange("status", "Pending");

      initializedRef.current = true;
    }

    if (!open) {
      initializedRef.current = false;
      setCurrentSlide(0);
    }
  }, [
    open,
    editingId,
    existingTicketIds,
    fullname,
    handleInputChange,
    handleSelectChange,
    department,
  ]);

  const insertRandomSuggestion = () => {
    const randomIndex = Math.floor(Math.random() * commonIssues.length);
    const suggestion = commonIssues[randomIndex].text;
    handleInputChange({
      target: { name: "ticket_subject", value: suggestion },
    } as React.ChangeEvent<HTMLTextAreaElement>);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) resetForm();
      }}
    >
      <SheetContent side="right" className="w-[420px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>{editingId ? "Edit Ticket" : "Add New Ticket"}</SheetTitle>
          <SheetDescription>
            Fill out the form below to {editingId ? "update" : "add"} a ticket.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 grid grid-cols-1 gap-4 max-h-[70vh] overflow-auto">

          {/* Suggestions Alert */}
          <Alert className="mb-4 p-4 relative max-w-md mx-auto">
            <AlertTitle className="text-lg font-semibold mb-2 text-center">
              Common Issues You Can Report
            </AlertTitle>
            <AlertDescription className="grid grid-cols-1 sm:grid-cols-1 gap-4">
              {issueChunks[currentSlide].map(({ icon, text }, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {icon}
                  <span>{text}</span>
                </div>
              ))}
            </AlertDescription>

            {/* Dots indicator */}
            <div className="mt-3 flex justify-center gap-2">
              {issueChunks.map((_, idx) => (
                <span
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  className={`h-2 w-2 rounded-full cursor-pointer ${idx === currentSlide ? "bg-[var(--mint-btn)]" : "bg-[var(--border-strong)]"
                    }`}
                  aria-label={`Slide ${idx + 1}`}
                />
              ))}
            </div>
          </Alert>

          {/* Ticket Subject */}
          <div className="flex flex-col w-full mb-2">
            <label className="mb-1 text-xs font-medium">
              Submit Your Problems or Issues
            </label>
            <Textarea
              name="ticket_subject"
              value={form.ticket_subject || ""}
              onChange={handleInputChange}
              placeholder="Enter your message"
              rows={10}
              className="capitalize"
            />
            <Button
              variant="outline"
              className="mt-2 w-max self-start"
              onClick={insertRandomSuggestion}
            >
              Suggest Issue
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Alert className="p-4">
            <AlertTitle className="mb-2">Ticket Information</AlertTitle>
            <AlertDescription className="space-y-2">
              <div>
                <div className="font-semibold text-[var(--text)]">
                  Ticket Number: {form.ticket_id || "-"}
                </div>
                <Input
                  type="hidden"
                  name="ticket_id"
                  value={form.ticket_id || ""}
                />
              </div>
              <div>
                <div className="font-semibold text-[var(--text)]">
                  Full Name: {form.requestor_name || "-"}
                </div>
                <Input
                  type="hidden"
                  name="requestor_name"
                  value={form.requestor_name || ""}
                />
              </div>
              <div>
                <div className="font-semibold text-[var(--text)]">
                  Department: {form.department || "-"}
                </div>
                <Input
                  type="hidden"
                  name="department"
                  value={form.department || ""}
                />
              </div>
              <Input type="hidden" name="mode" value="Acculog" />
              <Input type="hidden" name="status" value="Pending" />

              <div className="font-semibold text-[var(--text)] mt-4">Status: Pending</div>
            </AlertDescription>
          </Alert>
        </div>

        <SheetFooter className="mt-6 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button onClick={editingId ? handleUpdate : handleSubmit}>
            {editingId ? "Update" : "Submit"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
