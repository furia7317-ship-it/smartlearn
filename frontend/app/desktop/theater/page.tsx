import DesktopGalgame from "@/components/desktop/desktop-galgame";
import { DiscoverReturnLink } from "@/components/desktop/discover-return-link";

export default function TheaterPage() {
  return <div className="flex h-full min-h-0 flex-col">
    <nav aria-label="返回上级页面" className="shrink-0 border-b border-[#d8c9b2] bg-[#f8f3e9] px-4 py-1"><DiscoverReturnLink /></nav>
    <div className="min-h-0 flex-1"><DesktopGalgame /></div>
  </div>;
}
