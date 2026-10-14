export default function DesktopRouteLoading() {
  return (
    <section
      className="grid h-full min-h-0 place-content-center gap-3 bg-[#f8f3e9] text-center text-[#675844]"
      role="status"
      aria-live="polite"
    >
      <span
        className="mx-auto block size-7 animate-spin rounded-full border-2 border-[#c8b99f] border-t-[#865c2b]"
        aria-hidden
      />
      <p className="text-xs font-semibold tracking-[0.16em]">正在展开页面</p>
    </section>
  );
}
