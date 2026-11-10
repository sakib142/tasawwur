import Link from "next/link";
import { Studio } from "@/components/Studio";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-10 px-6 py-12">
      <header className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">tasawwur</h1>
          <span lang="ar" dir="rtl" className="text-lg text-stone-400">
            تصور
          </span>
        </div>
        <p className="text-sm text-stone-500">
          Arabic for imagining — from ṣ-w-r, the root that also gives the word for an
          image. Describe something; get the picture back.
        </p>
        </div>
        <Link
          href="/settings"
          className="shrink-0 text-sm text-stone-500 underline underline-offset-4 hover:text-stone-900 dark:hover:text-stone-100"
        >
          Settings
        </Link>
      </header>

      <Studio />
    </main>
  );
}
