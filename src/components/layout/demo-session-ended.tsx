/** Shown in place of the page when the demo profile behind it is gone or
 *  out of date: every data call would be refused, so the only way on is the
 *  demo picker. A full page load there starts the app afresh. */
export function DemoSessionEndedNotice({ message }: { message: string }) {
  return (
    <div className="bg-surface-primary flex min-h-screen items-center justify-center">
      <div
        role="alert"
        className="bg-surface-elevated border-default mx-4 max-w-lg rounded-2xl border p-8 text-center shadow-xl"
      >
        <h1 className="text-primary mb-3 text-2xl font-bold">
          Choose a demo profile
        </h1>
        <p className="text-muted mb-6">{message}</p>
        <a
          href="/demo"
          className="inline-block rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700"
        >
          Choose a demo profile
        </a>
      </div>
    </div>
  );
}
