import Link from "next/link";
import { SettingsForm } from "@/components/SettingsForm";

export const metadata = { title: "Settings · tasawwur" };

export default function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/"
          className="self-start text-sm text-stone-500 underline underline-offset-4 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-stone-500">
          Stored on this machine, outside the project. API keys are written but never read
          back into the browser.
        </p>
      </header>

      <SettingsForm />
    </main>
  );
}
