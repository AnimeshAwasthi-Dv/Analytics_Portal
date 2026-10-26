import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type DesktopLicense, type LicenseKeyAnalytics } from "../services/api";
import "./desktop.css";

export function LicenseKeyAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const [service, setService] = useState<string>("XRAY");
  const [licenses, setLicenses] = useState<DesktopLicense[]>([]);
  const [selectedId, setSelectedId] = useState<number>(Number(params.get("licenseId")) || 0);
  const [data, setData] = useState<LicenseKeyAnalytics | null>(null);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Load analytics for a specific license ID
  const loadAnalytics = useCallback(async (id: number) => {
    if (!id) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const analytics = await api.getLicenseKeyAnalytics(id);
      setData(analytics);
      const keyService = (analytics.license.service || "").toUpperCase();
      if (keyService && keyService !== service) {
        setService(keyService);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load key analytics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [service]);

  // Load licenses for a given service and select initial/current license
  const loadLicensesForService = useCallback(
    async (targetService: string, preferredId?: number, clearSearch: boolean = false) => {
      setLoading(true);
      setError("");
      if (clearSearch) setSearch("");
      try {
        const rows = await api.getDesktopLicenses(targetService);
        setLicenses(rows);

        // Pick preferred ID if valid for this list, otherwise fallback to first license
        const resolvedId =
          preferredId && rows.some(x => x.id === preferredId)
            ? preferredId
            : rows[0]?.id || 0;

        setSelectedId(resolvedId);
        if (resolvedId) {
          setParams({ licenseId: String(resolvedId) }, { replace: true });
          const analytics = await api.getLicenseKeyAnalytics(resolvedId);
          setData(analytics);
        } else {
          setParams({}, { replace: true });
          setData(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load licenses");
        setLicenses([]);
        setData(null);
        setSelectedId(0);
      } finally {
        setLoading(false);
      }
    },
    [setParams]
  );

  const isFirstMount = useRef(true);

  // Initial load and URL param change sync
  useEffect(() => {
    const urlLicenseId = Number(params.get("licenseId")) || 0;
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (urlLicenseId) {
        api
          .getLicenseKeyAnalytics(urlLicenseId)
          .then(analytics => {
            const svc = (analytics.license.service || "XRAY").toUpperCase();
            setService(svc);
            void loadLicensesForService(svc, urlLicenseId);
          })
          .catch(() => {
            void loadLicensesForService("XRAY");
          });
      } else {
        void loadLicensesForService("XRAY");
      }
      return;
    }

    if (urlLicenseId && urlLicenseId !== selectedId) {
      setSelectedId(urlLicenseId);
      void loadAnalytics(urlLicenseId);
    }
  }, [params, selectedId, loadAnalytics, loadLicensesForService]);

  // Handle service dropdown change (X-ray vs CT)
  const handleServiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newService = e.target.value.toUpperCase();
    setService(newService);
    setData(null);
    void loadLicensesForService(newService, undefined, true);
  };

  // Filter licenses based on search input
  const visible = licenses.filter(x => {
    if (!search.trim()) return true;
    const term = search.toLowerCase().trim();
    return (
      (x.licenseKey && x.licenseKey.toLowerCase().includes(term)) ||
      (x.fullName && x.fullName.toLowerCase().includes(term)) ||
      (x.username && x.username.toLowerCase().includes(term)) ||
      (x.mobile && x.mobile.toLowerCase().includes(term)) ||
      (x.vendor && x.vendor.toLowerCase().includes(term))
    );
  });

  // Handle license selection from key dropdown
  const handleKeySelect = (id: number) => {
    setSelectedId(id);
    if (id) {
      setParams({ licenseId: String(id) }, { replace: true });
      void loadAnalytics(id);
    } else {
      setParams({}, { replace: true });
      setData(null);
    }
  };

  // Handle search typing
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearch(term);

    const trimmed = term.toLowerCase().trim();
    if (!trimmed) {
      // Restored full list: keep selected key if in list, else select first
      if (!licenses.some(x => x.id === selectedId) && licenses.length > 0) {
        handleKeySelect(licenses[0].id);
      }
      return;
    }

    const filtered = licenses.filter(x =>
      (x.licenseKey && x.licenseKey.toLowerCase().includes(trimmed)) ||
      (x.fullName && x.fullName.toLowerCase().includes(trimmed)) ||
      (x.username && x.username.toLowerCase().includes(trimmed)) ||
      (x.mobile && x.mobile.toLowerCase().includes(trimmed)) ||
      (x.vendor && x.vendor.toLowerCase().includes(trimmed))
    );

    if (filtered.length > 0) {
      // Auto-select first match if current selection is not among the filtered results
      if (!filtered.some(x => x.id === selectedId)) {
        handleKeySelect(filtered[0].id);
      }
    } else {
      // No matches found
      setSelectedId(0);
      setData(null);
    }
  };

  // Handle Enter key in search box
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && visible.length > 0) {
      handleKeySelect(visible[0].id);
    }
  };

  // Handle clearing search input
  const handleClearSearch = () => {
    setSearch("");
    if (!licenses.some(x => x.id === selectedId) && licenses.length > 0) {
      handleKeySelect(licenses[0].id);
    }
  };

  // Handle Refresh button
  const handleRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const rows = await api.getDesktopLicenses(service);
      setLicenses(rows);
      const targetId = (rows.some(x => x.id === selectedId) ? selectedId : rows[0]?.id) || 0;
      setSelectedId(targetId);
      if (targetId) {
        setParams({ licenseId: String(targetId) }, { replace: true });
        const analytics = await api.getLicenseKeyAnalytics(targetId);
        setData(analytics);
      } else {
        setParams({}, { replace: true });
        setData(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to refresh data");
    } finally {
      setRefreshing(false);
    }
  };

  const license = data?.license;

  return (
    <main className="license-page">
      <header className="license-header">
        <div>
          <h1>Key Analytics</h1>
          <p>Credit consumption and activity calculated from the saved license record.</p>
        </div>
        <button
          className="secondary"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          aria-label="Refresh key analytics"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <section className="license-filter-panel">
        <strong>Choose a license key</strong>
        <div className="license-filter-grid">
          <select
            aria-label="Service"
            value={service}
            onChange={handleServiceChange}
            disabled={loading || refreshing}
          >
            <option value="XRAY">X-ray</option>
            <option value="CT">CT</option>
          </select>

          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <input
              aria-label="Search keys"
              placeholder="Search key, user, mobile"
              value={search}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              style={{ paddingRight: search ? "28px" : undefined }}
            />
            {search && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                style={{
                  position: "absolute",
                  right: "8px",
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "2px 6px",
                  fontSize: "14px",
                  minHeight: "unset",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>

          <select
            aria-label="License key"
            value={selectedId || ""}
            onChange={e => handleKeySelect(Number(e.target.value))}
            disabled={loading || refreshing || visible.length === 0}
          >
            {visible.length === 0 ? (
              <option value="">No matching keys</option>
            ) : (
              <>
                <option value="">Select a key</option>
                {visible.map(x => (
                  <option key={x.id} value={x.id}>
                    {x.licenseKey} · {x.fullName || x.username || x.vendor || "Unassigned"}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
      </section>

      {error && <p className="license-message license-error">{error}</p>}

      {search && visible.length === 0 && !loading && (
        <p className="license-message" style={{ color: "#64748b" }}>
          No license keys found matching "{search}".
        </p>
      )}

      {license && data && (
        <>
          <section className="license-kpis">
            <article>
              <span>Plan credits</span>
              <strong>{data.planCredits.toLocaleString()}</strong>
              <small>{license.planName}</small>
            </article>
            <article>
              <span>Credits used</span>
              <strong>{data.creditsUsed.toLocaleString()}</strong>
              <small>Plan credits minus saved credit balance</small>
            </article>
            <article>
              <span>Credits remaining</span>
              <strong>{data.creditsRemaining.toLocaleString()}</strong>
              <small>Current credit_left value</small>
            </article>
            <article>
              <span>Credit usage</span>
              <strong>{data.usagePercent}%</strong>
              <small>
                {license.status} · {license.platform}
              </small>
            </article>
          </section>

          <section className="license-analytics-grid">
            <article className="license-panel">
              <h2>Credit balance</h2>
              <div className="key-credit-bar">
                <i style={{ width: `${Math.min(data.usagePercent, 100)}%` }} />
              </div>
              <p>
                {data.creditsUsed.toLocaleString()} used of{" "}
                {data.planCredits.toLocaleString()} allocated credits
              </p>
            </article>
            <article className="license-panel">
              <h2>License activity</h2>
              <div className="license-detail-list">
                <span>Successful validations</span>
                <strong>{data.validations}</strong>
                <span>Activations</span>
                <strong>{data.activationCount}</strong>
                <span>Activation attempts</span>
                <strong>{data.activationAttempts}</strong>
                <span>Fraud attempts</span>
                <strong>{data.fraudAttempts}</strong>
              </div>
            </article>
          </section>

          <section className="license-panel">
            <h2>License record</h2>
            <div className="license-detail-list">
              <span>License key</span>
              <strong className="license-key">{license.licenseKey}</strong>
              <span>Status</span>
              <strong>{license.status}</strong>
              <span>Service / platform</span>
              <strong>
                {license.service} / {license.platform}
              </strong>
              <span>Plan</span>
              <strong>{license.planName}</strong>
              <span>Full name</span>
              <strong>{license.fullName || "—"}</strong>
              <span>Username</span>
              <strong>{license.username || "—"}</strong>
              <span>Mobile</span>
              <strong>{license.mobile || "—"}</strong>
              <span>Organisation</span>
              <strong>{license.vendor || "—"}</strong>
              <span>Last sync</span>
              <strong>
                {license.lastSync ? new Date(license.lastSync).toLocaleString() : "Never"}
              </strong>
              <span>Last validation</span>
              <strong>
                {license.lastValidationAt
                  ? new Date(license.lastValidationAt).toLocaleString()
                  : "Never"}
              </strong>
              <span>System hash</span>
              <strong>{license.systemHash || "—"}</strong>
              <span>MAC address</span>
              <strong>{license.macAddress || "—"}</strong>
              <span>Fraud detected</span>
              <strong>
                {license.fraudDetected ? license.lastFraudReason || "Yes" : "No"}
              </strong>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
