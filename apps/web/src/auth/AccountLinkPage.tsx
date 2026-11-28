import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  accountLinkTokenSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
} from '@lootdrop/contracts';
import { requestPasswordReset, resetPassword, verifyAccountEmail } from '../lib/api-client.js';
import { useAuth } from './AuthProvider.js';

type Mode = 'request-reset' | 'reset-password' | 'verify-email';

const content = {
  'request-reset': {
    title: 'Forgot your password?',
    description: 'Enter the email address you use for LootDrop.',
    submit: 'Send reset link',
    success: 'If an account exists for that email, a reset link will be sent.',
  },
  'reset-password': {
    title: 'Reset your password',
    description: 'Choose a new password for your LootDrop account.',
    submit: 'Save new password',
    success: 'Your password has been reset. Log in with your new password.',
  },
  'verify-email': {
    title: 'Verify your email',
    description: 'Confirm this email address for your LootDrop account.',
    submit: 'Verify email address',
    success: 'Your email address is verified.',
  },
};

export function AccountLinkPage({ mode }: { mode: Mode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { title, description, submit, success: successMessage } = content[mode];
  const token = accountLinkTokenSchema.safeParse(
    new URLSearchParams(location.hash.slice(1)).get('token'),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      if (mode === 'request-reset') {
        const parsed = forgotPasswordRequestSchema.safeParse({ email });
        if (!parsed.success) {
          setError('Enter a valid email address.');
          return;
        }
        await requestPasswordReset(parsed.data);
      } else if (mode === 'reset-password') {
        if (password !== confirmation) {
          setError('The passwords do not match.');
          return;
        }
        const parsed = resetPasswordRequestSchema.safeParse({ token: token.data, password });
        if (!parsed.success) {
          setError('Use at least 12 characters and no more than 72 bytes.');
          return;
        }
        await resetPassword(parsed.data);
        setPassword('');
        setConfirmation('');
      } else if (token.success) {
        await verifyAccountEmail(token.data);
      }
      setSuccess(true);
      if (mode !== 'request-reset') navigate(location.pathname, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  const canVerify = state.status === 'authenticated';
  return (
    <main className="auth-shell">
      <div className="auth-card account-link-card">
        <p className="eyebrow">LootDrop</p>
        <h1>{title}</h1>
        {success ? (
          <>
            <p role="status">{successMessage}</p>
            <a href={mode === 'verify-email' ? '/' : '/login'}>
              {mode === 'verify-email' ? 'Back to your account' : 'Back to log in'}
            </a>
          </>
        ) : mode !== 'request-reset' && !token.success ? (
          <>
            <p role="alert">This link is missing or incomplete.</p>
            <Link to={mode === 'reset-password' ? '/forgot-password' : '/'}>
              {mode === 'reset-password' ? 'Request a new reset link' : 'Go to LootDrop'}
            </Link>
          </>
        ) : mode === 'verify-email' && !canVerify ? (
          <>
            <p>Log in to the account that received this link to continue.</p>
            <Link to="/login" state={{ returnTo: location.pathname + location.hash }}>
              Log in to verify
            </Link>
          </>
        ) : (
          <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <p>{description}</p>
            {mode === 'request-reset' ? (
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            ) : null}
            {mode === 'reset-password' ? (
              <>
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Please wait…' : submit}
            </button>
            {mode === 'reset-password' ? (
              <Link to="/forgot-password">Request a new reset link</Link>
            ) : (
              <Link to={mode === 'verify-email' ? '/' : '/login'}>
                {mode === 'verify-email' ? 'Back to your account' : 'Back to log in'}
              </Link>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
