import Link from "next/link";
import {
  ArrowRight,
  Drama,
  ShieldCheck,
  Sparkles,
  Store,
  UsersRound,
} from "lucide-react";

const DISCOVERY_AREAS = [
  {
    href: "/desktop/theater",
    eyebrow: "沉浸式学习",
    title: "互动教学",
    description: "把知识点放进角色、情境和分支选择中，通过参与和反馈完成理解。",
    action: "进入互动课堂",
    icon: Drama,
    accent: "border-[#bb704c]/35 bg-[#fff8f2] text-[#8f4428]",
  },
  {
    href: "/desktop/market",
    eyebrow: "优质内容发现",
    title: "学习市场",
    description: "浏览经过审核的课程资料与学习路径，按需收藏或导入自己的学习空间。",
    action: "浏览学习市场",
    icon: Store,
    accent: "border-[#56806c]/35 bg-[#f4faf6] text-[#315f4b]",
  },
] as const;

export default function DesktopDiscover() {
  return (
    <div className="desktop-book-page thin-scroll h-full overflow-y-auto">
      <div className="desktop-book-page__frame mx-auto max-w-[1280px] space-y-6 px-8 py-7">
        <header className="rounded-2xl border border-[#d8c6aa] bg-[#fffaf1] px-7 py-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#92642f]">
                学习发现
              </span>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-[#352719]">
                发现新的学习方式
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#756552]">
                这里集中放置探索型功能。需要完成当前任务时回到学习路径，需要答疑或生成资料时前往智能教师。
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d9c7aa] bg-[#f5ecde] px-3 py-2 text-xs font-medium text-[#6d5130]">
              <Sparkles className="size-4" />
              两种探索入口
            </span>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-2" aria-label="发现功能">
          {DISCOVERY_AREAS.map((area) => {
            const Icon = area.icon;
            return (
              <Link
                key={area.href}
                href={area.href}
                className="group flex min-h-64 flex-col rounded-2xl border border-[#d9c9b1] bg-[#fffdf8] p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[#a9783f] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9b692f]/45"
              >
                <span className={`grid size-12 place-items-center rounded-xl border ${area.accent}`}>
                  <Icon className="size-6" />
                </span>
                <span className="mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8d765c]">
                  {area.eyebrow}
                </span>
                <h2 className="mt-2 font-display text-2xl font-semibold text-[#392a1a]">{area.title}</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[#766754]">{area.description}</p>
                <span className="mt-auto flex items-center gap-2 pt-7 text-sm font-semibold text-[#8f5723]">
                  {area.action}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </section>

        <section className="grid gap-3 rounded-2xl border border-[#d9c9b1] bg-[#f7efe2] p-5 text-[#5f4c37] md:grid-cols-2">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#315f4b]" />
            <div>
              <h2 className="text-sm font-semibold text-[#3f3020]">内容经过审核</h2>
              <p className="mt-1 text-xs leading-5">学习市场只展示已发布内容，导入后仍进入你的资源中心统一管理。</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <UsersRound className="mt-0.5 size-5 shrink-0 text-[#8f4428]" />
            <div>
              <h2 className="text-sm font-semibold text-[#3f3020]">探索不打断主路径</h2>
              <p className="mt-1 text-xs leading-5">互动学习的结果保留在当前账号中，主学习任务仍由学习路径承接。</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
