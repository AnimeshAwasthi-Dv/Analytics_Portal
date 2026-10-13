import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type ControlOverview } from "../services/api.ts";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    if ("response" in error) {
      const response = error.response;
      if (
        typeof response === "object" &&
        response !== null &&
        "data" in response
      ) {
        const data = response.data;
        if (
          typeof data === "object" &&
          data !== null &&
          "detail" in data &&
          typeof data.detail === "string"
        ) {
          return data.detail;
        }
      }
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return "The request could not be completed. Please try again.";
}

export function ControlPage() {
  const [overview, setOverview] = useState<ControlOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeyAdminPassword, setApiKeyAdminPassword] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userAdminPassword, setUserAdminPassword] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [apiKeySuccess, setApiKeySuccess] = useState("");
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [generatingApiKey, setGeneratingApiKey] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [savingUser, setSavingUser] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadingError("");
    try {
      setOverview(await api.getControlOverview());
    } catch (error) {
      setLoadingError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getControlOverview()
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch((error: unknown) => {
        if (active) setLoadingError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const generateApiKey = async () => {
    setApiKeyError("");
    setApiKeySuccess("");
    setGeneratingApiKey(true);
    try {
      setApiKeyValue(await api.generateControlApiKey());
    } catch (error) {
      setApiKeyError(errorMessage(error));
    } finally {
      setGeneratingApiKey(false);
    }
  };

  const copyApiKey = async () => {
    if (!apiKeyValue) return;
    try {
      await navigator.clipboard.writeText(apiKeyValue);
      setCopiedApiKey(true);
      window.setTimeout(() => setCopiedApiKey(false), 1800);
    } catch {
      setApiKeyError("Could not copy the API key. Select and copy it manually.");
    }
  };

  useEffect(() => {
    void generateApiKey();
  }, []);

  const handleApiKeySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApiKeyError("");
    setApiKeySuccess("");
    setSavingApiKey(true);
    try {
      const created = await api.createControlApiKey({
        keyName: apiKeyName.trim(),
        apiKey: apiKeyValue.trim(),
        adminPassword: apiKeyAdminPassword,
      });
      setApiKeyName("");
      setApiKeyAdminPassword("");
      setApiKeyValue(created.apiKey);
      setApiKeySuccess(`${created.keyName} was added. Copy the API key now; it will not be shown again.`);
      await loadOverview();
    } catch (error) {
      setApiKeyError(errorMessage(error));
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleUserSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUserError("");
    setUserSuccess("");
    setSavingUser(true);
    try {
      const created = await api.createControlUser({
        name: userName.trim(),
        email: userEmail.trim(),
        password: userPassword,
        adminPassword: userAdminPassword,
      });
      setUserName("");
      setUserEmail("");
      setUserPassword("");
      setUserAdminPassword("");
      setUserSuccess(`${created.email} can now sign in.`);
      await loadOverview();
    } catch (error) {
      setUserError(errorMessage(error));
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <div className="control-page">
      <div className="control-content">
        <header className="control-header">
          <div>
            <p className="control-eyebrow">ADMINISTRATION</p>
            <h1>Control</h1>
            <p>Manage the API credentials and user access for DecXpert.</p>
          </div>
          <button
            type="button"
            className="control-refresh"
            onClick={() => void loadOverview()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {loadingError && (
          <div className="control-notice control-notice-error" role="alert">
            <strong>Control data could not be loaded.</strong>
            <span>{loadingError}</span>
          </div>
        )}

        <section className="control-form-grid" aria-label="Create credentials and users">
          <article className="control-card">
            <div className="control-card-heading">
              <span className="control-card-index">01</span>
              <div>
                <h2>Add an API key</h2>
                <p>Register a named instance credential for sync access.</p>
              </div>
            </div>
            <form className="control-form" onSubmit={handleApiKeySubmit}>
              <label>
                <span>Instance name</span>
                <input
                  value={apiKeyName}
                  onChange={(event) => setApiKeyName(event.target.value)}
                  autoComplete="off"
                  maxLength={120}
                  placeholder="e.g. Imaging Node 3"
                  required
                />
              </label>
              <label>
                <span>{apiKeySuccess ? "Created API key" : "Generated API key"}</span>
                <div className="api-key-input-row">
                  <input
                    type="text"
                    value={apiKeyValue}
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={generatingApiKey ? "Generating secure key..." : "Generate a key to continue"}
                    required
                  />
                  <button type="button" onClick={() => void copyApiKey()} disabled={!apiKeyValue}>
                    {copiedApiKey ? "Copied" : "Copy"}
                  </button>
                </div>
                <button type="button" onClick={() => void generateApiKey()} disabled={generatingApiKey || savingApiKey}>
                  {generatingApiKey ? "Generating..." : "Generate another key"}
                </button>
              </label>
              <label>
                <span>Confirm administrator password</span>
                <input
                  type="password"
                  value={apiKeyAdminPassword}
                  onChange={(event) => setApiKeyAdminPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {apiKeyError && (
                <p className="control-form-message is-error" role="alert">
                  {apiKeyError}
                </p>
              )}
              {apiKeySuccess && (
                <p className="control-form-message is-success" role="status">
                  {apiKeySuccess}
                </p>
              )}
              <button type="submit" disabled={savingApiKey || generatingApiKey || !apiKeyValue}>
                {savingApiKey ? "Creating API key..." : "Create API key"}
              </button>
              <p className="control-form-hint">
                Generated with cryptographically secure randomness. The key is hashed in storage and shown here only.
              </p>
            </form>
          </article>

          <article className="control-card">
            <div className="control-card-heading">
              <span className="control-card-index">02</span>
              <div>
                <h2>Add a user</h2>
                <p>Create a sign-in account for a member of your team.</p>
              </div>
            </div>
            <form className="control-form" onSubmit={handleUserSubmit}>
              <label>
                <span>Full name</span>
                <input
                  value={userName}
                  onChange={(event) => setUserName(event.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  placeholder="Enter the user's name"
                  required
                />
              </label>
              <label>
                <span>Email address</span>
                <input
                  type="email"
                  value={userEmail}
                  onChange={(event) => setUserEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="name@organization.com"
                  required
                />
              </label>
              <label>
                <span>Temporary password</span>
                <input
                  type="password"
                  value={userPassword}
                  onChange={(event) => setUserPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  placeholder="At least 12 characters"
                  required
                />
              </label>
              <label>
                <span>Confirm administrator password</span>
                <input
                  type="password"
                  value={userAdminPassword}
                  onChange={(event) => setUserAdminPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              {userError && (
                <p className="control-form-message is-error" role="alert">
                  {userError}
                </p>
              )}
              {userSuccess && (
                <p className="control-form-message is-success" role="status">
                  {userSuccess}
                </p>
              )}
              <button type="submit" disabled={savingUser}>
                {savingUser ? "Creating user..." : "Create user"}
              </button>
              <p className="control-form-hint">
                New users are created as standard accounts and cannot access Control.
              </p>
            </form>
          </article>
        </section>

        <section className="control-inventory" aria-label="Saved database entries">
          <div className="control-inventory-heading">
            <div>
              <p className="control-eyebrow">DATABASE INVENTORY</p>
              <h2>Saved in DecXpert</h2>
            </div>
            <span>{overview ? "Live database records" : "Loading records..."}</span>
          </div>
          <div className="control-inventory-grid">
            <article className="control-inventory-card">
              <div className="control-inventory-card-heading">
                <h3>API keys</h3>
                <span>{overview?.apiKeys.length ?? "—"}</span>
              </div>
              {overview?.apiKeys.length ? (
                <ul>
                  {overview.apiKeys.map((key) => (
                    <li key={key.id}>
                      <span className="control-record-mark" aria-hidden="true" />
                      <span>{key.keyName}</span>
                      <small>Secret hidden</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="control-empty">
                  {loading ? "Loading API keys..." : "No API keys were found."}
                </p>
              )}
            </article>
            <article className="control-inventory-card">
              <div className="control-inventory-card-heading">
                <h3>User accounts</h3>
                <span>{overview?.users.length ?? "—"}</span>
              </div>
              {overview?.users.length ? (
                <ul>
                  {overview.users.map((user) => (
                    <li key={user.id}>
                      <span className="control-record-mark is-user" aria-hidden="true" />
                      <span className="control-user-record">
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </span>
                      <small>{user.isActive ? "Active" : "Inactive"}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="control-empty">
                  {loading ? "Loading users..." : "No users were found."}
                </p>
              )}
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}
