import { useState } from "react";
import { api, type User } from "../services/api";
import { WorkspaceIcon as Icon } from "../Components/WorkspaceIcon";
export function LoginPage({
  onLoginSuccess,
}: {
  onLoginSuccess: (user: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="workspace-login">
      <section className="workspace-login-story">
        <a href="/login" className="workspace-brand">
          <img src="/brand-mark.svg" alt="" />
          <span>
            <strong>DECTROCEL</strong>
            <small>Organization command</small>
          </span>
        </a>
        <div className="workspace-login-message">
          <span>ONE ORGANIZATION. ONE COMMAND.</span>
          <h1>
            Your entire operation.
            <br />
            <em>In one clear view.</em>
          </h1>
          <p>
            Bring your portals, centers, services and people together. See what
            matters. Act with confidence.
          </p>
          <div className="workspace-login-network">
            <div>
              <img src="/brand-mark.svg" alt="" />
              <strong>Central command</strong>
            </div>
            <section>
              {["Marengo", "Goyal MRI", "Common PACS", "On-prem"].map(
                (name) => (
                  <span key={name}>
                    <i />
                    {name}
                  </span>
                ),
              )}
            </section>
          </div>
          <div className="workspace-login-features">
            <span>
              <Icon name="chart" size={17} />
              Organization-wide intelligence
            </span>
            <span>
              <Icon name="controls" size={17} />
              Audited operational controls
            </span>
            <span>
              <Icon name="team" size={17} />
              Role-based team access
            </span>
          </div>
        </div>
        <footer>DECTROCEL · CENTRAL OPERATIONS PLATFORM</footer>
      </section>
      <section className="workspace-login-form-panel">
        <div className="workspace-login-form-wrap">
          <span className="workspace-login-eyebrow">
            YOUR ORGANIZATION WORKSPACE
          </span>
          <h2>Welcome back.</h2>
          <p>Sign in to your central command.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              setLoading(true);
              try {
                const result = await api.login(email.trim(), password);
                onLoginSuccess(result.user);
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Unable to sign in. Check your credentials.",
                );
              } finally {
                setLoading(false);
              }
            }}
          >
            {error && (
              <div className="workspace-login-error" role="alert">
                <Icon name="alert" size={17} />
                {error}
              </div>
            )}
            <label htmlFor="work-email">
              Work email
              <input
                id="work-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@organization.com"
              />
            </label>
            <label htmlFor="work-password">
              Password
              <span className="workspace-password-field">
                <input
                  id="work-password"
                  aria-label="Password"
                  type={visible ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => !v)}
                  aria-label={visible ? "Hide password" : "Show password"}
                >
                  {visible ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            <button
              type="submit"
              className="workspace-login-submit"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign in to workspace"}
              <Icon name="arrow" size={17} />
            </button>
          </form>
          <div className="workspace-login-restricted">
            <Icon name="key" size={15} />
            <span>
              Authorized Dectrocel team members only.
              <br />
              Contact your administrator if you need access.
            </span>
          </div>
        </div>
        <footer>
          Protected access · Account permissions apply throughout the workspace
        </footer>
      </section>
    </div>
  );
}
