import { Studio } from "@/components/Studio";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">tasawwur</h1>
          <span lang="ar" dir="rtl" className="text-lg text-stone-400">
            تصور
          </span>
        </div>
        <p className="text-sm text-stone-500">
          To imagine, and to picture — the same word in Arabic. Describe something; get the
          picture back.
        </p>
      </header>

      <Studio />
    </main>
  );
}
