"use client";

/* ============================================================================
   OB REQUEST · Tab A — Submit OB
   ----------------------------------------------------------------------------
   Image-first. Step 1 is the only required part: a photo of the signed paper
   ROBT form. Step 2 is optional detail that lets an admin filter the queue
   without opening the image, which is why every field in it is optional.
   ========================================================================== */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  ImagePlus,
  MapPin,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { compressImage, base64SizeKB } from "@/lib/image-compress";
import { uploadObImages } from "@/lib/storage";
import {
  MAX_OB_PHOTOS,
  MAX_OB_PHOTO_BYTES,
  computeLateFiling,
  daysUntil,
} from "@/lib/ob-requests";
import { Button, Hint, Switch } from "@/app/activity-planner/mint/ui";
import {
  ObAutoField,
  ObCard,
  ObCardHeader,
  ObDateField,
  ObDivider,
  ObGuidelinesBox,
  ObInput,
  ObPhotoHint,
  ObPhotoThumb,
  ObTextarea,
} from "./ob-shared";
import ObImageViewer from "./image-viewer";
import { submitObRequest, type ObProfile } from "./ob-data";

type Picked = { dataUrl: string; kb: number };

export function ObSubmitTab({
  profile,
  onSubmitted,
  userId,
}: {
  profile: ObProfile;
  onSubmitted: () => void | Promise<void>;
  userId?: string;
}) {
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const [photos, setPhotos] = useState<Picked[]>([]);
  const [destination, setDestination] = useState("");
  const [dateOfOB, setDateOfOB] = useState("");
  const [purpose, setPurpose] = useState("");
  const [justification, setJustification] = useState("");

  // Guideline 1 says the decision is the calendar's, so the toggle starts from
  // the computed answer and the agent can only acknowledge it — turning a
  // clearly-early trip into "late" would only misfile it.
  const autoLate = useMemo(() => computeLateFiling(dateOfOB || null), [dateOfOB]);
  const [isLateFiling, setIsLateFiling] = useState(false);
  const [lateTouched, setLateTouched] = useState(false);
  const late = lateTouched ? isLateFiling : autoLate;

  const days = useMemo(() => daysUntil(dateOfOB || null), [dateOfOB]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [submittedId, setSubmittedId] = useState<number | string | null>(null);

  const canSubmit = photos.length > 0 && !busy && submittedId === null;

  /* ── Image intake ─────────────────────────────────────────────────────── */

  const ingest = useCallback(async (files: FileList | null, fromCamera: boolean) => {
    if (!files || files.length === 0) return;

    const room = MAX_OB_PHOTOS - photos.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_OB_PHOTOS} images.`);
      return;
    }

    const picked: Picked[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} is not an image.`);
        continue;
      }
      if (file.size > MAX_OB_PHOTO_BYTES) {
        toast.error(`${file.name} is larger than ${MAX_OB_PHOTO_BYTES / 1024 / 1024}MB.`);
        continue;
      }
      try {
        const raw: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("read failed"));
          reader.readAsDataURL(file);
        });

        // Paper forms are documents, not photographs of scenery — a smaller
        // 1600px render is plenty for a reviewer to read a signature and cuts
        // the upload by roughly 80%.
        let out = raw;
        try {
          out = await compressImage(raw);
        } catch {
          /* keep the original if canvas is unavailable */
        }
        picked.push({ dataUrl: out, kb: base64SizeKB(out) });
      } catch {
        toast.error(`Could not read ${file.name}.`);
      }
    }

    if (picked.length === 0) return;

    // A phone camera often hands back a HEIC the browser can't decode; that
    // surfaces as a blank thumbnail, so say something rather than let it pass.
    if (fromCamera && picked.length === 0) {
      toast.error("That photo could not be read. Try taking it again.");
    }

    setPhotos((prev) => [...prev, ...picked].slice(0, MAX_OB_PHOTOS));
    if (picked.length) {
      toast.success(`${picked.length} image${picked.length > 1 ? "s" : ""} added.`);
    }
  }, [photos.length]);

  const onPick = (fromCamera: boolean) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = fromCamera ? cameraRef.current : galleryRef.current;
    await ingest(e.target.files, fromCamera);
    // Reset so picking the same file twice in a row still fires onChange.
    if (input) input.value = "";
  };

  const removePhoto = (i: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
    setViewerIndex((v) => (v === i ? null : v));
  };

  const retakeAll = () => {
    setPhotos([]);
    setViewerIndex(null);
    cameraRef.current?.click();
  };

  /* ── Submit ───────────────────────────────────────────────────────────── */

  const onSubmit = async () => {
    if (photos.length === 0) {
      toast.error("Attach a photo of the signed OB form first.");
      return;
    }

    setBusy(true);
    try {
      toast.info("Uploading the signed form…", { id: "ob-upload" });

      const uploaded = await uploadObImages(
        photos.map((p) => p.dataUrl),
        { referenceId: profile?.referenceId || userId || null }
      );

      toast.dismiss("ob-upload");

      const created = await submitObRequest({
        photos: uploaded.map((u) => u.url),
        destination: destination.trim(),
        dateOfOB,
        purposeOfTravel: purpose.trim(),
        // A late request without a reason cannot be escalated, so send the
        // reason here rather than letting the reviewer ask for it later.
        justification: late ? justification.trim() : "",
      });

      setSubmittedId(created.id);
      toast.success("OB request submitted.");
      await onSubmitted();

      setPhotos([]);
      setDestination("");
      setDateOfOB("");
      setPurpose("");
      setJustification("");
      setLateTouched(false);
    } catch (err: any) {
      toast.dismiss("ob-upload");
      toast.error(err?.message || "Could not submit the OB request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  /* ── Success state ────────────────────────────────────────────────────── */

  if (submittedId !== null) {
    return (
      <div className="space-y-4">
        <ObCard className="text-center py-8">
          <div
            className="w-16 h-16 rounded-[20px] flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
          >
            <CheckCircle2 size={30} strokeWidth={2.4} />
          </div>
          <p className="text-[16px] font-black text-[var(--text)] leading-tight">
            OB request submitted
          </p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 leading-relaxed max-w-[280px] mx-auto">
            Your signed form will be reviewed by HRAD. You&apos;ll get an email as
            soon as it&apos;s approved or declined.
          </p>
          <div className="flex justify-center mt-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
              style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
              Pending Review
            </span>
          </div>

          <div className="flex gap-2.5 mt-6">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => setSubmittedId(null)}
              icon={<Trash2 size={15} />}
            >
              Clear form
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => cameraRef.current?.click()}
              icon={<Camera size={15} />}
            >
              Submit another
            </Button>
          </div>
        </ObCard>
      </div>
    );
  }

  /* ── Form ─────────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-4">
      {/* STEP 1 — the photo */}
      <ObCard>
        <ObCardHeader
          icon={<Camera size={18} />}
          title="Step 1 · Photo of the signed form"
          subtitle={`Required · ${photos.length} of ${MAX_OB_PHOTOS} attached`}
          tone="clay"
          right={
            photos.length > 0 ? (
              <span className="text-[11px] font-extrabold" style={{ color: "var(--mint-strong)" }}>
                {photos.length}/{MAX_OB_PHOTOS}
              </span>
            ) : null
          }
        />

        {photos.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2.5 mb-3">
              {photos.map((p, i) => (
                <ObPhotoThumb
                  key={`${p.dataUrl.slice(-24)}-${i}`}
                  src={p.dataUrl}
                  index={i}
                  alt={`OB form image ${i + 1}`}
                  size={92}
                  onRemove={() => removePhoto(i)}
                  onOpen={() => setViewerIndex(i)}
                />
              ))}
            </div>

            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-[var(--text-muted)]">
                Total {photos.reduce((s, p) => s + p.kb, 0)} KB · tap to zoom
              </p>
              <button
                type="button"
                onClick={retakeAll}
                className="text-[11.5px] font-extrabold min-h-[32px] px-2"
                style={{ color: "var(--clay-ink)" }}
              >
                Retake
              </button>
            </div>
          </>
        )}

        {photos.length < MAX_OB_PHOTOS && (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1.5 min-h-[84px] rounded-[var(--r-card)] border-2 border-dashed transition-colors active:scale-[0.98]"
              style={{ borderColor: "var(--clay)", background: "var(--clay-soft)" }}
            >
              <Camera size={20} style={{ color: "var(--clay-ink)" }} />
              <span className="text-[12px] font-extrabold" style={{ color: "var(--clay-ink)" }}>
                Take photo
              </span>
            </button>

            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1.5 min-h-[84px] rounded-[var(--r-card)] border-2 border-dashed transition-colors active:scale-[0.98]"
              style={{ borderColor: "var(--border-strong)", background: "var(--card-alt)" }}
            >
              <ImagePlus size={20} style={{ color: "var(--mint)" }} />
              <span className="text-[12px] font-extrabold" style={{ color: "var(--mint-strong)" }}>
                From gallery
              </span>
            </button>
          </div>
        )}

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPick(true)}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onPick(false)}
        />

        <div className="mt-3">
          <ObPhotoHint />
        </div>
      </ObCard>

      {/* STEP 2 — the details */}
      <ObCard>
        <ObCardHeader
          icon={<FileText size={18} />}
          title="Step 2 · Trip details"
          subtitle="Optional, but it saves the reviewer from opening your image"
        />

        <div className="space-y-3.5">
          {/* Auto-filled identity — display only */}
          <div className="grid grid-cols-2 gap-2.5">
            <ObAutoField label="Name" value={profile?.name} />
            <ObAutoField label="Position" value={profile?.position} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <ObAutoField label="Department" value={profile?.department} />
            <ObAutoField label="Date Filed" value={new Date().toLocaleDateString("en-PH")} />
          </div>

          <ObDivider />

          <ObInput
            label="Destination"
            value={destination}
            onChange={setDestination}
            placeholder="e.g. Cebu City, Cebu"
            icon={<MapPin size={14} />}
          />

          <ObDateField
            label="Date of Official Business"
            value={dateOfOB}
            onChange={setDateOfOB}
            hint={days !== null ? `${days} day${days === 1 ? "" : "s"} from today` : undefined}
          />

          <ObTextarea
            label="Purpose of Travel"
            value={purpose}
            onChange={setPurpose}
            placeholder="e.g. Client onboarding and system training"
            rows={3}
            maxLength={500}
          />
        </div>
      </ObCard>

      {/* Late filing */}
      <ObCard>
        <ObCardHeader
          icon={<AlertTriangle size={18} />}
          title="Late filing"
          subtitle="Guideline 3 — a justification is expected"
          tone="clay"
        />

        {late && (
          <div className="mb-3.5">
            <Hint icon={<AlertTriangle size={14} />}>
              {dateOfOB
                ? `This trip is ${days === 0 ? "today" : "tomorrow"} — filed with less than one (1) day of notice. It will be flagged as a late filing, and a justification is expected.`
                : "Set a date of OB to confirm the notice period."}
            </Hint>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 py-1">
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight">
              File as a late request
            </p>
            <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
              {autoLate
                ? "Turn this off only if the trip is actually further out."
                : "On by itself once the date is within one day."}
            </p>
          </div>
          <Switch
            checked={late}
            label="File as a late request"
            onChange={(v) => {
              setIsLateFiling(v);
              setLateTouched(true);
            }}
          />
        </div>

        {late && (
          <div className="mt-3.5">
            <ObTextarea
              label="Justification"
              value={justification}
              onChange={setJustification}
              placeholder="e.g. Client requested an urgent visit; trip was confirmed the same day."
              rows={3}
              maxLength={500}
            />
            {!justification.trim() && (
              <p
                className="text-[11px] font-semibold mt-2 flex items-start gap-1.5 leading-relaxed"
                style={{ color: "var(--clay-ink)" }}
              >
                <AlertTriangle size={12} className="shrink-0 mt-px" />
                Without a reason this is likely to be declined.
              </p>
            )}
          </div>
        )}
      </ObCard>

      {/* Guidelines */}
      <ObGuidelinesBox defaultOpen={late} />

      {/* Submit */}
      <div className="sticky bottom-0 -mx-4 px-4 pb-3 pt-2" style={{ background: "var(--bg)" }}>
        <Button full size="lg" disabled={!canSubmit} loading={busy} onClick={onSubmit} icon={<Send size={18} />}>
          Submit OB Request
        </Button>
        <p className="text-[11px] font-semibold text-[var(--text-muted)] text-center mt-2 leading-relaxed">
          {photos.length === 0
            ? "Attach a photo of the signed form to enable submission."
            : late
              ? "This will be flagged as a late filing with your justification."
              : "HRAD will review the signed form."}
        </p>
      </div>

      {viewerIndex !== null && (
        <ObImageViewer
          images={photos.map((p) => p.dataUrl)}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}