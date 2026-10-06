import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  FileText,
  ArrowLeft,
  Database,
  CheckCircle2,
  Clock,
  Sparkles,
  UserCheck,
  Send,
  Building2,
  ShieldCheck,
  Radio,
} from "lucide-react";
import { api } from "../services/api.ts";
import { SyncReport } from "../types";

export const ReportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<SyncReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      api.getReportById(id).then(setReport).finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-500">Loading report details...</div>;
  }

  if (!report) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-800">Report not found.</p>
        <Link to="/reports" className="text-xs text-blue-600 underline">
          Back to Reports
        </Link>
      </div>
    );
  }

  const timelineSteps = [
    {
      title: "Study Created",
      timestamp: report.timestamps.study_created_at || "10:00:00",
      description: "Originating study generated at local PACS database instance",
      icon: Clock,
      completed: true,
      color: "blue",
    },
    {
      title: "AI Generated",
      timestamp: report.timestamps.ai_generated_at || "10:08:00",
      description: "Preliminary findings computed by clinical AI inference model",
      icon: Sparkles,
      completed: !!report.timestamps.ai_generated_at,
      color: "purple",
    },
    {
      title: "Reviewed",
      timestamp: report.timestamps.reviewed_at || "10:15:00",
      description: "Resident radiologist verified and amended preliminary report",
      icon: UserCheck,
      completed: !!report.timestamps.reviewed_at,
      color: "sky",
    },
    {
      title: "Approved",
      timestamp: report.timestamps.approved_at || "10:18:00",
      description: "Attending physician final signoff and digital seal",
      icon: CheckCircle2,
      completed: !!report.timestamps.approved_at,
      color: "emerald",
    },
    {
      title: "Pushed",
      timestamp: report.timestamps.pushed_at || "10:20:00",
      description: "Replicated by local Sync Agent to Central Ingestion API",
      icon: Send,
      completed: !!report.timestamps.pushed_at,
      color: "emerald",
    },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <Link
            to="/reports"
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">{report.report_id}</h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">
                {report.source_instance_id}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">UID: {report.study_uid}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Status:</span>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            {report.report_status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Report Information Details */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Report Metadata & Attribution
          </h3>

          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Report ID:</span>
              <span className="font-bold text-slate-900 font-mono">{report.report_id}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Study UID:</span>
              <span className="font-mono text-slate-800">{report.study_uid}</span>
            </div>
            <div className="py-2.5 flex justify-between items-center bg-blue-50/50 px-2 rounded">
              <span className="font-bold text-blue-900">Source Instance ID:</span>
              <span className="font-mono font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200">
                {report.source_instance_id}
              </span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Client Code:</span>
              <span className="font-semibold text-slate-800">{report.client_code}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Modality:</span>
              <span className="font-mono font-bold text-slate-800">{report.modality}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Service Name:</span>
              <span className="font-medium text-slate-800">{report.service_name}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Credits Used:</span>
              <span className="font-mono font-bold text-slate-900">{report.credits.credits_used} credits</span>
            </div>
          </div>
        </div>

        {/* Processing Timeline */}
        <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            End-to-End Processing Timeline
          </h3>

          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {timelineSteps.map((step, idx) => {
              const StepIcon = step.icon;
              return (
                <div key={idx} className="relative group">
                  {/* Step Bullet */}
                  <div
                    className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full border-2 bg-white flex items-center justify-center ${
                      step.completed ? "border-emerald-500 text-emerald-600" : "border-slate-300 text-slate-400"
                    }`}
                  >
                    <StepIcon className="w-3 h-3" />
                  </div>

                  {/* Content */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <strong className="text-slate-900">{step.title}</strong>
                      <span className="font-mono text-[11px] font-semibold text-blue-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {step.timestamp}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
