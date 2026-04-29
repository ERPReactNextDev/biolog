"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ToastContainer, toast, Slide } from "react-toastify";
import { useRouter } from "next/navigation";

import { VscEye, VscEyeClosed } from "react-icons/vsc";
import Link from "next/link";
import Image from "next/image";
import "react-toastify/dist/ReactToastify.css";

const steps = ["Account Info", "Department & Role", "Review & Submit"];

const MultiStepRegister: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  // Form fields
  const [Firstname, setFirstname] = useState("");
  const [Lastname, setLastname] = useState("");
  const [Email, setEmail] = useState("");
  const [Password, setPassword] = useState("");
  const [Department, setDepartment] = useState("");
  const [Role, setRole] = useState("");
  const [ReferenceID, setReferenceID] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const router = useRouter();

  const isDark = theme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  const generateReferenceID = () => {
    if (Firstname && Lastname) {
      const firstLetterFirst = Firstname.charAt(0).toUpperCase();
      const firstLetterLast = Lastname.charAt(0).toUpperCase();
      const randomNum = Math.floor(100000 + Math.random() * 900000);
      return `${firstLetterFirst}${firstLetterLast}-${randomNum}`;
    }
    return "";
  };

  useEffect(() => {
    setReferenceID(generateReferenceID());
  }, [Firstname, Lastname]);

  const getPasswordSuggestion = () => {
    if (Password.length === 0) return "Password must be at least 6 characters";
    if (Password.length < 6) return "Password too short";
    if (!/[A-Z]/.test(Password)) return "Include at least 1 capital letter";
    if (!/[0-9]/.test(Password)) return "Include at least 1 number";
    if (!/[^a-zA-Z0-9]/.test(Password)) return "Include at least 1 special character";
    return "Strong password!";
  };

  const validateStep = () => {
    if (currentStep === 0) {
      if (!Firstname || !Lastname || !Email || !Password) {
        toast.error("Please fill out all fields in Account Info.");
        return false;
      }
      if (getPasswordSuggestion() !== "Strong password!") {
        toast.error("Please fix your password according to suggestions.");
        return false;
      }
    }
    if (currentStep === 1) {
      if (!Department) {
        toast.error("Please select a Department.");
        return false;
      }
      if (!Role) {
        toast.error("Please select a Role.");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Firstname,
          Lastname,
          Email,
          Password,
          Department,
          Role,
          ReferenceID,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success("Registration successful!");
        setTimeout(() => router.push("/Login"), 1500);
      } else {
        toast.error(result.message || "Registration failed!");
      }
    } catch {
      toast.error("An error occurred while registering!");
    } finally {
      setLoading(false);
    }
  };

  const containerVariants = {
    enter: { opacity: 0, x: 100 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -100 },
  };

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-black via-gray-900 to-black transition-colors duration-300 ${isDark ? "bg-black text-white" : "bg-white text-black"
        }`}
    >
      <ToastContainer position="top-right" autoClose={3000} theme={theme} transition={Slide} />

      <motion.div
        key={currentStep}
        variants={containerVariants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.3 }}
        className={`bg-white dark:bg-black/10 p-6 rounded-xl shadow-lg w-full max-w-md`}
      >
        <div className="text-center mb-4">
          <Image src="/fluxx-tech-solutions-logo.png" alt="Logo" width={180} height={60} className="mx-auto mb-2" />
          <h2 className="text-md font-bold text-black text-left mt-4">{steps[currentStep]}:</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {currentStep === 0 && (
            <>
              <input
                type="text"
                placeholder="Firstname"
                value={Firstname}
                onChange={(e) => setFirstname(e.target.value)}
                className="w-full p-2 border-b text-xs text-black"
                required
              />
              <input
                type="text"
                placeholder="Lastname"
                value={Lastname}
                onChange={(e) => setLastname(e.target.value)}
                className="w-full p-2 border-b text-xs text-black"
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={Email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2 border-b bg-white text-xs text-black"
                required
              />
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={Password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 border-b bg-white text-xs text-black"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-2"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <VscEyeClosed /> : <VscEye />}
                </button>
              </div>
              <p className={`text-xs font-semibold ${getPasswordSuggestion() === "Strong password!" ? "text-green-500" : "text-yellow-500"}`}>
                {getPasswordSuggestion()}
              </p>
            </>
          )}

          {currentStep === 1 && (
            <>
              <select
                value={Department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full p-2 border-b bg-white text-xs text-black"
                required
              >
                <option value="">Select Department</option>
                <option value="Sales">Sales</option>
              </select>

              <select
                value={Role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full p-2 border-b bg-white text-xs text-black"
                required
              >
                <option value="">Select Role</option>
                <option value="Guest">Guest</option>
              </select>
            </>
          )}

          {currentStep === 2 && (
            <div className="text-xs space-y-2 text-black">
              <p>
                <strong>Fullname:</strong> {Firstname} {Lastname}
              </p>
              <p>
                <strong>Email:</strong> {Email}
              </p>
              <p>
                <strong>Department:</strong> {Department}
              </p>
              <p>
                <strong>Role:</strong> {Role}
              </p>
              <p>
                <strong>Reference ID:</strong> {ReferenceID}
              </p>
            </div>
          )}

          <div className="flex justify-between mt-4">
            {currentStep > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 bg-gray-400 hover:bg-cyan-400 hover:scale-[1.02] text-white font-semibold text-xs rounded-lg transition-all duration-300 shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={loading}
              >
                Back
              </button>
            )}
            {currentStep < steps.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="ml-auto px-4 py-2 bg-cyan-500 hover:bg-cyan-400 hover:scale-[1.02] text-white font-semibold text-xs rounded-lg transition-all duration-300 shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={loading}
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="ml-auto px-4 py-2 bg-black hover:bg-cyan-400 hover:scale-[1.02] text-white font-semibold text-xs rounded-lg transition-all duration-300 shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Submitting..." : "Sign Up"}
              </button>
            )}
          </div>
        </form>

        <p className="mt-6 text-xs text-center text-black">
          Already have an account?{" "}
          <Link href="/Login" className="text-cyan-400 underline">
            Login
          </Link>
        </p>
      </motion.div>
    </div>
  );
};

export default MultiStepRegister;
