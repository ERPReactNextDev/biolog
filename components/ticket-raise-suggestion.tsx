"use client";

import { motion } from "framer-motion";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Card } from "@/components/ui/card";
import { Info, CheckCircle, AlertTriangle, Phone, Zap } from "lucide-react";

export function TicketRaiseSuggestion() {
  const steps = [
    {
      title: "Submit a ticket",
      description: "Raise your IT concern by creating a ticket with detailed info.",
      status: "ready",
      icon: <Zap className="w-6 h-6 text-blue-500" />,
    },
    {
      title: "Provide details",
      description: "Explain your issue clearly for faster IT resolution.",
      status: "in-progress",
      icon: <AlertTriangle className="w-6 h-6 text-yellow-500" />,
    },
    {
      title: "IT reviews",
      description: "Our IT team reviews and processes your ticket promptly.",
      status: "review",
      icon: <CheckCircle className="w-6 h-6 text-green-500" />,
    },
    {
      title: "Contact support",
      description: "For urgent matters, contact IT directly after ticket submission.",
      status: "urgent",
      icon: <Phone className="w-6 h-6 text-blue-600" />,
    },
  ];

  const badgeColors: Record<string, string> = {
    ready: "bg-blue-100 text-blue-600",
    "in-progress": "bg-yellow-100 text-yellow-600",
    review: "bg-green-100 text-green-600",
    urgent: "bg-blue-100 text-blue-700",
  };

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-0 top-16 h-[280px] w-[280px] rounded-full bg-blue-500/10 blur-[100px]" />
        <div className="absolute right-0 bottom-10 h-[320px] w-[320px] rounded-full bg-green-500/10 blur-[120px]" />
      </div>

      {/* Full width alert */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-12"
      >
        <Alert className="backdrop-blur-lg bg-white/30 border border-gray-200 rounded-3xl p-8 shadow-lg w-full">
          <AlertTitle className="flex items-center justify-center gap-3 text-3xl font-semibold text-blue-700">
            <Info className="w-8 h-8" /> How to Raise a Ticket Concern
          </AlertTitle>
          <AlertDescription className="mt-4 text-lg text-gray-700 space-y-4 max-w-4xl mx-auto">
            Here’s how you can quickly raise a ticket and get help from the IT department:
          </AlertDescription>
        </Alert>
      </motion.div>

      {/* Grid with 2 columns on md+ screens, 1 column on smaller */}
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.15 } },
        }}
        className="grid grid-cols-1 md:grid-cols-2 gap-8"
      >
        {steps.map(({ title, description, status, icon }) => (
          <motion.div
            key={title}
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } },
            }}
          >
            <Card className="flex items-start gap-4 rounded-3xl border border-gray-300 bg-white/60 p-6 backdrop-blur-sm shadow-md hover:shadow-lg transition-shadow duration-300">
              <div className="flex items-center justify-center rounded-full border border-gray-300 bg-white p-3 text-blue-600">
                {icon}
              </div>
              <div>
                <div
                  className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${badgeColors[status]}`}
                >
                  {status.replace("-", " ")}
                </div>
                <h3 className="mt-2 text-xl font-semibold text-gray-900">{title}</h3>
                <p className="mt-1 text-gray-600">{description}</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
