import Link from "next/link";

const steps = [
  {
    title: "Place a bid or ask",
    body: "Say the most you'd pay, or the least you'd accept, for up to 4 tickets.",
  },
  {
    title: "Get matched",
    body: "When a bid meets an ask, you're matched instantly. Or tap Take on any order in the book.",
  },
  {
    title: "Money released after the event",
    body: "Payment stays on hold until 24 hours after the party, so both sides are protected.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-20">
      <section className="max-w-3xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-900">
          For IE University students
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl">
          Resell and buy event tickets, safely.
        </h1>
        <p className="mt-5 text-lg text-stone-700">
          Beebly is a live order book for IE University students: set the price you&apos;d pay or
          accept, we match you, and payment stays on hold until after the party.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/signup" className="btn btn-primary px-6 text-base">
            Sign up
          </Link>
          <p className="text-sm text-stone-700">
            Already have an account?{" "}
            <Link href="/login" className="link">
              Log in
            </Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="mt-16">
        <h2 id="how-heading" className="text-2xl font-bold text-stone-900">
          How it works
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="card">
              <span className="badge bg-amber-100 text-amber-900">Step {i + 1}</span>
              <h3 className="mt-3 font-semibold text-stone-900">{step.title}</h3>
              <p className="mt-2 text-sm text-stone-700">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="guarantee-heading"
        className="mt-12 rounded-xl border-2 border-stone-900 bg-amber-50 p-6"
      >
        <h2 id="guarantee-heading" className="text-xl font-bold text-stone-900">
          Safe-resale guarantee
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-stone-800">
          <li>The buyer&apos;s payment is held, not sent, when you match.</li>
          <li>The seller marks the ticket as transferred; the buyer confirms all is good.</li>
          <li>If there is a problem, the buyer reports it and the funds stay on hold.</li>
          <li>Prices are capped at face value until an event sells out.</li>
        </ul>
        <p className="mt-4 text-sm text-stone-700">
          Beebly keeps the difference between bid and ask. Prototype: no real payments or tickets.
        </p>
      </section>
    </div>
  );
}
