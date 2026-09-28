export default function DashboardLoading() {
  return (
    <div className="min-h-dvh bg-void px-5 py-8 text-cream sm:px-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="h-16 w-64 animate-pulse rounded-lg bg-white/10" />
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse rounded-lg bg-white/8"
            />
          ))}
        </div>
        <div className="mt-6 h-[520px] animate-pulse rounded-lg bg-white/8" />
      </div>
    </div>
  );
}
