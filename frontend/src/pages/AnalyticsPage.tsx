import React, { useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BarChart3, Filter, RefreshCw, Layers } from "lucide-react";

export const AnalyticsPage: React.FC = () => {
  const [selectedRange, setSelectedRange] = useState("7d");
  const [selectedInstance, setSelectedInstance] = useState("ALL");

  // 1. Records synchronized per instance
  const recordsPerInstanceData = [
    { name: "DB-01 (Ahmedabad)", records: 245120, pending: 120 },
    { name: "DB-02 (Delhi)", records: 310420, pending: 83 },
    { name: "DB-03 (Mumbai)", records: 198320, pending: 340 },
    { name: "DB-04 (Bangalore)", records: 280120, pending: 72 },
    { name: "DB-05 (Chennai)", records: 214580, pending: 91 },
  ];

  // 2. Sync success vs failure
  const successVsFailureData = [
    { name: "Successful Syncs", value: 1248543, color: "#10b981" },
    { name: "Failed Ingestions", value: 17, color: "#ef4444" },
  ];

  // 3. Records synchronized over time
  const timeSeriesData = [
    { time: "06:00", "DB-01": 2400, "DB-02": 3100, "DB-03": 1800, "DB-04": 2900, "DB-05": 2100 },
    { time: "08:00", "DB-01": 5200, "DB-02": 6400, "DB-03": 4100, "DB-04": 5800, "DB-05": 4600 },
    { time: "10:00", "DB-01": 8900, "DB-02": 11200, "DB-03": 7200, "DB-04": 9900, "DB-05": 7800 },
    { time: "12:00", "DB-01": 12400, "DB-02": 15800, "DB-03": 9900, "DB-04": 14100, "DB-05": 11000 },
    { time: "14:00", "DB-01": 18100, "DB-02": 22300, "DB-03": 14200, "DB-04": 20400, "DB-05": 15800 },
    { time: "16:00", "DB-01": 24500, "DB-02": 31000, "DB-03": 19800, "DB-04": 28000, "DB-05": 21400 },
  ];

  // 4. Reports by client
  const clientData = [
    { client: "MARENGO_AHMEDABAD", count: 245120 },
    { client: "MAX_DELHI", count: 310420 },
    { client: "FORTIS_MUMBAI", count: 198320 },
    { client: "MANIPAL_BLR", count: 280120 },
    { client: "APOLLO_CHENNAI", count: 214580 },
  ];

  // 5. Reports by modality
  const modalityData = [
    { name: "XR (X-Ray)", value: 45, color: "#3b82f6" },
    { name: "CT Scan", value: 28, color: "#8b5cf6" },
    { name: "MR (MRI)", value: 17, color: "#06b6d4" },
    { name: "US (Ultrasound)", value: 10, color: "#10b981" },
  ];

  // 6. Credits used by instance
  const creditsData = [
    { instance: "DB-01", credits: 735360 },
    { instance: "DB-02", credits: 931260 },
    { instance: "DB-03", credits: 594960 },
    { instance: "DB-04", credits: 840360 },
    { instance: "DB-05", credits: 643740 },
  ];

  // 7. Processing time distribution
  const processingTimeData = [
    { stage: "Study Created -> AI", seconds: 480 },
    { stage: "AI -> Reviewed", seconds: 420 },
    { stage: "Reviewed -> Approved", seconds: 180 },
    { stage: "Approved -> Sync Push", seconds: 120 },
  ];

  // 8. API request volume & Failed trends
  const apiVolumeData = [
    { day: "Mon", requests: 42000, failed: 4 },
    { day: "Tue", requests: 46500, failed: 2 },
    { day: "Wed", requests: 51200, failed: 5 },
    { day: "Thu", requests: 48900, failed: 1 },
    { day: "Fri", requests: 54100, failed: 3 },
    { day: "Sat", requests: 38200, failed: 1 },
    { day: "Sun", requests: 31000, failed: 1 },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner & Filters */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Central Ingestion & Synchronization Analytics
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live telemetry and aggregation across 5 independent database nodes
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedRange}
              onChange={(e) => setSelectedRange(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
            >
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid of Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Records Synchronized per Instance */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            1. Records Synchronized per Instance
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={recordsPerInstanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="records" fill="#2563eb" name="Synced Records" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Sync Success vs Failure */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            2. Sync Success vs Failure Rate
          </h3>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={successVsFailureData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {successVsFailureData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Records Synchronized Over Time */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 lg:col-span-2">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            3. Ingestion Timeline Across 5 Instances
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="DB-01" stroke="#2563eb" strokeWidth={2} />
                <Line type="monotone" dataKey="DB-02" stroke="#10b981" strokeWidth={2} />
                <Line type="monotone" dataKey="DB-03" stroke="#f59e0b" strokeWidth={2} />
                <Line type="monotone" dataKey="DB-04" stroke="#8b5cf6" strokeWidth={2} />
                <Line type="monotone" dataKey="DB-05" stroke="#ec4899" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Reports by Modality */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            4. Clinical Reports by Modality (%)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={modalityData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {modalityData.map((entry, index) => (
                    <Cell key={`mod-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 5: Credits Used by Instance */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            5. Total Ingestion Credits by Database Instance
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={creditsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="instance" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="credits" fill="#4f46e5" name="Credits Consumed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 6: Processing Time per Pipeline Stage */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            6. Average Processing Latency by Pipeline Stage (Seconds)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processingTimeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="stage" type="category" width={140} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="seconds" fill="#0ea5e9" name="Latency (sec)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 7: API Request Volume & Error Trends */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            7. Central API Request Ingestion Volume vs Failures
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={apiVolumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="requests" fill="#3b82f6" name="Total Ingest Requests" />
                <Bar dataKey="failed" fill="#ef4444" name="Failed Syncs" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
