import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";

import styles from "./desktop-discover.module.css";

const MARKET_ITEMS = [
  {
    title: "《算法之美》精读",
    category: "计算机科学",
    description: "从原型到实践，理解算法设计的核心思想。",
    lessons: 24,
    image: "/brand/discover/market-algorithm-v1.png",
    alt: "山间亭台与层叠峰峦的水墨画",
  },
  {
    title: "《史记》选读",
    category: "人文历史",
    description: "在历史的细节中，理解人性与抉择。",
    lessons: 18,
    image: "/brand/discover/market-history-v1.png",
    alt: "宣纸、毛笔与砚台组成的古籍研读画面",
  },
  {
    title: "《古诗词》鉴赏入门",
    category: "文学素养",
    description: "从意象到意境，读懂诗词的美与情感。",
    lessons: 20,
    image: "/brand/discover/market-poetry-v1.png",
    alt: "群山、河谷与扁舟构成的水墨诗境",
  },
] as const;

export default function DesktopDiscover() {
  return (
    <main className={`${styles.page} thin-scroll`}>
      <div className={styles.frame}>
        <section className={styles.hero} aria-labelledby="discover-title">
          <Image
            src="/brand/discover/discover-scroll-hero-v1.png"
            alt="群山、书院、卷轴知识图谱与古籍构成的探索主题画卷"
            fill
            priority
            sizes="(min-width: 1180px) 1240px, 94vw"
            className={styles.heroImage}
          />
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>今日策展</span>
            <h1 id="discover-title">发现新的学习方式</h1>
            <p>从一次好奇出发，找到适合你的学习方式</p>
            <Link href="/desktop/market" className={styles.heroAction}>
              开始探索
              <ArrowRight aria-hidden />
            </Link>
          </div>
          <Image
            src="/brand/discover/discover-seal-v1.png"
            alt=""
            width={35}
            height={59}
            className={styles.heroSeal}
            aria-hidden
          />
        </section>

        <div className={styles.discoveryGrid}>
          <section className={styles.featureCard} aria-labelledby="interactive-title">
            <Image
              src="/brand/discover/discover-maze-pine-v1.png"
              alt="古松下带有朱砂旗帜的石砌迷宫"
              fill
              priority
              sizes="(min-width: 1180px) 660px, 94vw"
              className={styles.featureImage}
            />
            <div className={styles.featureContent}>
              <span className={styles.recommendBadge}>本期推荐</span>
              <span className={styles.featureKicker}>沉浸式学习</span>
              <h2 id="interactive-title">互动教学</h2>
              <p>把知识点放进角色、情境和分支选择中，<br />通过参与和反馈完成理解。</p>
              <ul className={styles.featureTags} aria-label="互动教学特点">
                <li>情境</li>
                <li>分支</li>
                <li>反馈</li>
              </ul>
              <Link href="/desktop/theater" className={styles.featureAction}>
                进入互动课堂
                <ArrowRight aria-hidden />
              </Link>
            </div>
            <div className={styles.featureCaption}>
              <strong>二叉树迷宫课堂</strong>
              <span>在选择与反馈中理解结构与关系</span>
            </div>
          </section>

          <section className={styles.marketCard} aria-labelledby="market-title">
            <header className={styles.marketHeader}>
              <h2 id="market-title">精选书目 / 课程</h2>
              <Link href="/desktop/market">
                学习市场
                <ChevronRight aria-hidden />
              </Link>
            </header>

            <div className={styles.marketList}>
              {MARKET_ITEMS.map((item) => (
                <Link key={item.title} href="/desktop/market" className={styles.marketItem}>
                  <Image
                    src={item.image}
                    alt={item.alt}
                    width={120}
                    height={82}
                    sizes="120px"
                  />
                  <span className={styles.marketCopy}>
                    <strong>{item.title}</strong>
                    <small>{item.category}</small>
                    <span>{item.description}</span>
                  </span>
                  <span className={styles.lessonCount}>共 {item.lessons} 讲</span>
                </Link>
              ))}
            </div>

            <Link href="/desktop/market" className={styles.marketAction}>
              浏览学习市场
              <ArrowRight aria-hidden />
            </Link>
          </section>
        </div>

        <figure className={styles.journey} aria-label="持续展开的学习长卷">
          <Image
            src="/brand/discover/discover-journey-panorama-v1.png"
            alt="山水、亭台、书案和藏书门构成的学习漫游长卷"
            fill
            sizes="(min-width: 1180px) 1248px, 94vw"
            className={styles.journeyImage}
          />
          <figcaption>
            <span>学习漫游</span>
            <strong>山水之间，探索继续</strong>
          </figcaption>
        </figure>
      </div>
    </main>
  );
}
