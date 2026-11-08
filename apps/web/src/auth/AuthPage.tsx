import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { loginRequestSchema, registerRequestSchema } from '@dealhunter/contracts';
import { useAuth } from './AuthProvider.js';
import { ApiError, login, registerAccount } from '../lib/api-client.js';

type AuthMode = 'login' | 'register';
type AuthForm = { displayName: string; email: string; password: string };
type FieldErrors = Partial<Record<keyof AuthForm, string>>;

const emptyForm: AuthForm = { displayName: '', email: '', password: '' };

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { state, acceptSession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const returnToValue = (location.state as { returnTo?: unknown } | null)?.returnTo;
  const returnTo =
    typeof returnToValue === 'string' &&
    returnToValue.startsWith('/') &&
    !returnToValue.startsWith('//')
      ? returnToValue
      : '/';

  if (state.status === 'loading') {
    return (
      <main className="page-shell">
        <div className="page-inner request-state" role="status">
          Restoring your session…
        </div>
      </main>
    );
  }
  if (state.status === 'authenticated') return <Navigate to={returnTo} replace />;

  const updateField = (field: keyof AuthForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldErrors({});
    setError('');

    const parsed =
      mode === 'register'
        ? registerRequestSchema.safeParse(form)
        : loginRequestSchema.safeParse({ email: form.email, password: form.password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'email' || field === 'password' || field === 'displayName') &&
          errors[field] === undefined
        ) {
          errors[field] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setIsPending(true);
    try {
      const session =
        mode === 'register'
          ? await registerAccount(parsed.data as typeof form)
          : await login(parsed.data);
      acceptSession(session);
      setForm(emptyForm);
      navigate(returnTo, { replace: true });
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setError('Invalid email or password');
      } else if (requestError instanceof ApiError && requestError.status === 409) {
        setError('Unable to register with these details.');
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Authentication could not be completed. Try again.',
        );
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-panel">
        <div className="auth-copy">
          <p className="eyebrow">DealHunter</p>
          <h1>Track the best game deals before everyone else.</h1>
          <p className="auth-subtitle">
            Sign in to save games and discover new titles, price drops, and gaming bargains.
          </p>
          <ul className="feature-list">
            <li>Live deal tracking</li>
            <li>Smart game search</li>
            <li>Your personal wishlist</li>
          </ul>
        </div>

        <div className="auth-card">
          <div className="auth-toggle">
            <Link className={mode === 'login' ? 'active' : ''} to="/login" state={location.state}>
              Log in
            </Link>
            <Link
              className={mode === 'register' ? 'active' : ''}
              to="/register"
              state={location.state}
            >
              Register
            </Link>
          </div>
          <form onSubmit={(event) => void handleSubmit(event)} className="auth-form" noValidate>
            {mode === 'register' ? (
              <label htmlFor="auth-display-name">
                Display name
                <input
                  id="auth-display-name"
                  autoComplete="name"
                  value={form.displayName}
                  maxLength={50}
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  aria-describedby={fieldErrors.displayName ? 'display-name-error' : undefined}
                  onChange={(event) => updateField('displayName', event.target.value)}
                  placeholder="Alex Morgan"
                />
                {fieldErrors.displayName ? (
                  <span id="display-name-error" className="field-error">
                    {fieldErrors.displayName}
                  </span>
                ) : null}
              </label>
            ) : null}
            <label htmlFor="auth-email">
              Email address
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={form.email}
                maxLength={254}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="you@example.com"
              />
              {fieldErrors.email ? (
                <span id="email-error" className="field-error">
                  {fieldErrors.email}
                </span>
              ) : null}
            </label>
            <label htmlFor="auth-password">
              Password
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={form.password}
                minLength={12}
                maxLength={128}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                onChange={(event) => updateField('password', event.target.value)}
                placeholder="12 to 128 characters"
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              {fieldErrors.password ? (
                <span id="password-error" className="field-error">
                  {fieldErrors.password}
                </span>
              ) : null}
            </label>
            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="primary-button" disabled={isPending}>
              {isPending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
