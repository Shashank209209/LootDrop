import { useState } from 'react';
import { resendAccountVerification } from '../lib/api-client.js';

export function EmailVerificationNotice() {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');

  async function resend() {
    setPending(true);
    try {
      await resendAccountVerification();
      setNotice('Check your inbox or spam folder for the verification link.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not request a link. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="email-verification-notice" aria-label="Email verification">
      <p>Verify your email to confirm you own this address.</p>
      <button
        type="button"
        className="ghost-button"
        disabled={pending}
        onClick={() => void resend()}
      >
        {pending ? 'Requesting link…' : 'Resend verification email'}
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
