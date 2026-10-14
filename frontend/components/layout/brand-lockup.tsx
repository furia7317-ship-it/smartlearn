import Image from "next/image";
import Link from "next/link";

export function BrandLockup() {
  return (
    <Link href="/app" className="web-brand" aria-label="学枢学习总览">
      <span className="web-brand__mark" aria-hidden>
        <Image src="/brand/xueshu-app-icon-128.webp" alt="" width={32} height={32} sizes="32px" />
      </span>
      <span className="web-brand__copy">
        <strong>学枢</strong>
        <small>AI 个性化学习平台</small>
      </span>
      <span className="web-brand__mascot" aria-hidden>
        <Image
          src="/brand/animals/red-panda-plan.webp"
          alt=""
          width={38}
          height={38}
          sizes="38px"
        />
      </span>
    </Link>
  );
}
