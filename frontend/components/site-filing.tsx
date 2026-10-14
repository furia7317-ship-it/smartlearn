/** Public filing information is specific to the deployment, never a data code. */
export function SiteFiling() {
  const number = process.env.NEXT_PUBLIC_ICP_NUMBER?.trim();
  if (!number) return null;

  return (
    <a
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`工业和信息化部备案查询：${number}`}
      style={{ whiteSpace: "nowrap", textDecoration: "underline", textUnderlineOffset: "3px" }}
    >
      {number}
    </a>
  );
}
