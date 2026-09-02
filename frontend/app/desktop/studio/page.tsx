import { redirect } from "next/navigation";

/** Legacy compatibility route: the desktop teacher now opens in-place. */
export default function LegacyDesktopStudioPage() {
  redirect("/desktop?teacher=open");
}
