import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, Clock, MapPin, ListChecks, Plus, Save, X } from "lucide-react";
import { Loader2 } from "lucide-react"
; // Adjust import for Loader2 if needed
import React from "react";

interface JobSheetProps {
  isOpen: boolean;
  onClose: () => void;
  jobTitle: string;
  setJobTitle: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  jobType: string;
  setJobType: (value: string) => void;
  location: string;
  setLocation: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  qualifications: string[];
  setQualifications: (quals: string[]) => void;
  loading: boolean;
  editingId: string | null;
  handleSubmit: (e: React.FormEvent) => void | Promise<void>;
  addQualification: () => void;
  updateQualification: (index: number, value: string) => void;
  removeQualification: (index: number) => void;
}

export const JobSheet: React.FC<JobSheetProps> = ({
  isOpen,
  onClose,
  jobTitle,
  setJobTitle,
  category,
  setCategory,
  jobType,
  setJobType,
  location,
  setLocation,
  status,
  setStatus,
  qualifications,
  setQualifications,
  loading,
  editingId,
  handleSubmit,
  addQualification,
  updateQualification,
  removeQualification,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative bg-white h-screen w-full max-w-2xl shadow-2xl overflow-y-auto"
      >
        {/* MODAL HEADER */}
        <div className="p-8 border-b border-gray-100 sticky top-0 bg-white/80 backdrop-blur-md z-20 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-50 text-[#d11a2a] rounded-xl">
              <Briefcase size={24} />
            </div>
            <h3 className="font-black uppercase italic tracking-tighter text-2xl">
              {editingId ? "Edit Job" : "New Vacancy"}
            </h3>
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={onClose}
              className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-black"
            >
              Discard
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-black text-white px-10 py-4 rounded-full font-black uppercase text-[10px] tracking-[0.2em] hover:bg-[#d11a2a] flex items-center gap-3 shadow-xl shadow-gray-200"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <>
                  <Save size={16} /> Save Post
                </>
              )}
            </button>
          </div>
        </div>

        {/* MODAL FORM CONTENT */}
        <div className="p-12 space-y-12 pb-32">
          {/* Title Input */}
          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase text-gray-400 tracking-[0.2em]">
              Position Title
            </label>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Job Title"
              className="w-full text-4xl font-black uppercase italic outline-none border-b-4 border-gray-50 focus:border-[#d11a2a] transition-all placeholder:text-gray-400 pb-2"
            />
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-2">
                <Briefcase size={12} className="text-[#d11a2a]" /> Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full font-black text-xs uppercase outline-none bg-gray-50 p-4 rounded-2xl border-none cursor-pointer focus:ring-2 focus:ring-[#d11a2a]/10"
              >
                <option>Sales</option>
                <option>Engineering</option>
                <option>Admin & HR</option>
                <option>Information Technology</option>
                <option>Marketing</option>
                <option>E-Commerce</option>
                <option>Customer Service Representative</option>
                <option>Accounting</option>
                <option>Procurement</option>
                <option>Product Development</option>
              </select>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-2">
                <Clock size={12} className="text-[#d11a2a]" /> Job Type
              </label>
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className="w-full font-black text-xs uppercase outline-none bg-gray-50 p-4 rounded-2xl border-none cursor-pointer focus:ring-2 focus:ring-[#d11a2a]/10"
              >
                <option>Full Time</option>
                <option>Part Time</option>
                <option>Contractual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-2">
                <MapPin size={12} className="text-[#d11a2a]" /> Location
              </label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. CDO, Manila"
                className="w-full font-black text-xs uppercase outline-none bg-gray-50 p-4 rounded-2xl border-none focus:ring-2 focus:ring-[#d11a2a]/10"
              />
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase text-gray-400">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full font-black text-xs uppercase outline-none bg-gray-50 p-4 rounded-2xl border-none cursor-pointer focus:ring-2 focus:ring-[#d11a2a]/10"
              >
                <option>Open</option>
                <option>Closed</option>
              </select>
            </div>
          </div>

          {/* DYNAMIC QUALIFICATIONS */}
          <div className="space-y-6 pt-6">
            <div className="flex justify-between items-end border-b-2 border-gray-50 pb-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-gray-400 flex items-center gap-2 tracking-widest">
                  <ListChecks size={16} className="text-[#d11a2a]" /> Job
                  Qualifications
                </label>
                <p className="text-[9px] font-bold text-gray-300 uppercase">
                  Add specific requirements for this role
                </p>
              </div>
              <button
                type="button"
                onClick={addQualification}
                className="text-[9px] font-black bg-black text-white px-5 py-2 rounded-xl flex items-center gap-2 hover:bg-[#d11a2a] transition-all shadow-lg shadow-gray-100"
              >
                <Plus size={14} /> Add Requirement
              </button>
            </div>

            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {qualifications.map((qual, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center gap-4 group bg-white p-3 border border-gray-100 rounded-2xl hover:border-[#d11a2a]/30 transition-all shadow-sm"
                  >
                    <span className="text-[10px] font-black text-[#d11a2a] w-8 h-8 flex items-center justify-center bg-red-50 rounded-xl shrink-0 italic shadow-inner">
                      {index + 1}
                    </span>
                    <input
                      value={qual}
                      onChange={(e) => updateQualification(index, e.target.value)}
                      placeholder="Enter requirement..."
                      className="flex-grow bg-transparent outline-none text-sm font-bold text-gray-700 placeholder:text-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeQualification(index)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-gray-300 hover:text-red-500 transition-all scale-90 group-hover:scale-100"
                    >
                      <X size={16} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>

              {qualifications.length === 0 && (
                <div className="text-center py-10 border-2 border-dashed border-gray-100 rounded-[2rem]">
                  <p className="text-[10px] font-black text-gray-200 uppercase tracking-widest italic">
                    No qualifications defined
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
