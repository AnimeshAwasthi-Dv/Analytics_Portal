import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ControlOverview } from "../services/api";
import { WorkspaceIcon as Icon } from "../Components/WorkspaceIcon";
import { WorkspaceDrawer } from "../Components/WorkspaceDrawer";
import "./command-center.css";
export function ControlPage() {
  const [data, setData] = useState<ControlOverview | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .getControlOverview()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load API access.",
          );
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function begin() {
    setOpen(true);
    setSaved(false);
    setName("");
    setPassword("");
    setKey("");
    setError("");
    setCopied(false);
    setBusy(true);
    try {
      setKey(await api.generateControlApiKey());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare a key.");
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setOpen(false);
    setPassword("");
    setKey("");
  }
  return (
    <div className="cc-page">
      <header className="cc-page-heading">
        <div>
          <div className="cc-eyebrow">INTEGRATION ACCESS</div>
          <h1>API access</h1>
          <p>
            Registered credentials used by source instances to synchronize with
            central operations.
          </p>
        </div>
        <div className="cc-page-actions">
          <button className="primary" onClick={() => void begin()}>
            <Icon name="plus" size={16} />
            Create API key
          </button>
          <button
            className="cc-icon-button"
            aria-label="Refresh API access"
            onClick={() => {
              setError("");
              setRevision((v) => v + 1);
            }}
          >
            <Icon name="refresh" size={17} />
          </button>
        </div>
      </header>
      {error && !open && (
        <div className="cc-alert danger" role="alert">
          {error}
        </div>
      )}
      <section className="cc-card">
        <header className="cc-card-heading">
          <div>
            <h2>Instance credentials</h2>
            <p>
              {data?.apiKeys.length ?? 0} registered credentials · Existing key
              values are never returned
            </p>
          </div>
          <Icon name="key" size={19} />
        </header>
        <div className="cc-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Instance name</th>
                <th>Credential type</th>
                <th>Storage</th>
              </tr>
            </thead>
            <tbody>
              {data?.apiKeys.map((k) => (
                <tr key={k.id}>
                  <td>
                    <span className="cc-name-with-icon">
                      <i>
                        <Icon name="key" size={15} />
                      </i>
                      <strong>{k.keyName}</strong>
                    </span>
                  </td>
                  <td>Source synchronization</td>
                  <td>Hashed secret</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.apiKeys.length && (
            <div className="cc-empty">
              <span>
                <Icon name="key" size={24} />
              </span>
              <strong>
                {data
                  ? "No registered instance credentials"
                  : "Loading registered credentials..."}
              </strong>
              <p>Create an API key to authorize a source instance.</p>
            </div>
          )}
        </div>
      </section>
      <div className="cc-explainer">
        <Icon name="team" />
        <div>
          <strong>Looking for team access?</strong>
          <p>
            Colleague accounts and their roles are managed separately from
            integration credentials.
          </p>
          <Link to="/team">
            Manage your internal team <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
      {open && (
        <WorkspaceDrawer
          title={saved ? "API key created" : "Create an instance credential"}
          subtitle={
            saved
              ? "Save this key before closing this panel"
              : "Register a named source instance for synchronization"
          }
          onClose={close}
        >
          {saved ? (
            <div className="cc-drawer-form">
              <div className="cc-form-note">
                <Icon name="check" size={19} />
                The credential for {name} is registered. Its secret is shown
                only in this panel.
              </div>
              <label>
                New API key
                <textarea
                  rows={3}
                  readOnly
                  value={key}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(key);
                    setCopied(true);
                  } catch {
                    setError("Select and copy the key manually.");
                  }
                }}
              >
                {copied ? "Copied" : "Copy API key"}
              </button>
              {error && (
                <div className="cc-alert danger" role="alert">
                  {error}
                </div>
              )}
              <footer>
                <button onClick={close}>Done</button>
              </footer>
            </div>
          ) : (
            <form
              className="cc-drawer-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const created = await api.createControlApiKey({
                    keyName: name.trim(),
                    apiKey: key,
                    adminPassword: password,
                  });
                  setKey(created.apiKey);
                  setSaved(true);
                  setPassword("");
                  setRevision((v) => v + 1);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not create the key.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Instance name
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="For example, Marengo sync agent"
                />
              </label>
              <label>
                Your administrator password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <div className="cc-form-note">
                <Icon name="key" size={18} />A secure random key is prepared
                automatically. The database stores its hash.
              </div>
              {error && (
                <div className="cc-alert danger" role="alert">
                  {error}
                </div>
              )}
              <footer>
                <button type="button" onClick={close}>
                  Cancel
                </button>
                <button className="primary" disabled={busy || !key}>
                  {busy ? "Preparing credential..." : "Create API key"}
                </button>
              </footer>
            </form>
          )}
        </WorkspaceDrawer>
      )}
    </div>
  );
}
